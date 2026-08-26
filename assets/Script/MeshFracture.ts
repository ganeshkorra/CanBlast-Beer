import {
    _decorator, Component, Node, Vec3, Quat, Mat4, Mesh, MeshRenderer, MeshCollider,
    RigidBody, Collider, ICollisionEvent, utils, gfx,
} from 'cc';
import { FragmentController } from './FragmentController';

const { ccclass, property } = _decorator;

/**
 * 可打碎物体：被撞下平台、碰到 GROUND 层时把 mesh 切分成若干带物理的碎片。
 *
 * 用法：把本组件挂到想打碎的节点上（该节点需要有 MeshRenderer + Collider + RigidBody），
 * 例如场景里的 stone2 / stone3 / beer。
 *
 * 前提：场景里 GROUND 层的节点必须带物理碰撞体（如 demo.scene 的 ground 节点有 MeshCollider），
 * 否则落体永远不会触发 onCollisionEnter，也就不会破碎。
 */
@ccclass('MeshFracture')
export class MeshFracture extends Component {
    /** GROUND 层位值（见 settings/v2/packages/project.json 的 layer 配置：GROUND = 2） */
    private static readonly GROUND_LAYER = 2;

    /** 目标碎块数量（5~7 手感最佳） */
    @property({ tooltip: '目标碎块数量' })
    public pieceCount: number = 6;

    /** 碎片继承落地瞬间速度的比例 */
    @property({ tooltip: '碎片继承落地瞬间速度的比例' })
    public transferFactor: number = 0.6;

    /** 额外随机炸开速度 */
    @property({ tooltip: '额外随机炸开速度' })
    public scatterForce: number = 1.5;

    private _shattered = false;
    private _rigid: RigidBody | null = null;
    private _renderer: MeshRenderer | null = null;
    private _collider: Collider | null = null;
    private readonly _tmpVel = new Vec3();

    start() {
        this._rigid = this.getComponent(RigidBody);
        // MeshRenderer 可能在子节点上（FBX 导入后 mesh 挂在子节点，物理在父节点）
        this._renderer = this.getComponent(MeshRenderer) || this.getComponentInChildren(MeshRenderer);
        this._collider = this.getComponent(Collider);
        if (this._collider) {
            // 注意：必须等碰撞体 onLoad（shape 已创建）之后再注册，碰撞事件才会开启
            this._collider.on('onCollisionEnter', this.onCollision, this);
        }
    }

    onDestroy() {
        if (this._collider) this._collider.off('onCollisionEnter', this.onCollision, this);
    }

    private onCollision(event: ICollisionEvent) {
        if (this._shattered) return;
        const other = event.otherCollider;
        if (!other) return;
        // 只有撞到 GROUND 层才破碎（物体被撞下平台、落地时触发）
        if ((other.node.layer & MeshFracture.GROUND_LAYER) === 0) return;

        // 碎片初速度 = 本物体落地瞬间的速度（被撞飞后自带速度）
        const impactVel = this._tmpVel;
        if (this._rigid) this._rigid.getLinearVelocity(impactVel);
        else impactVel.set(0, 0, 0);

        this.shatter(impactVel);
    }

    /**
     * 把当前物体切碎成多块物理碎片，然后移除原物体。
     * @param impactVel 撞击速度（用于给碎片初速度）
     */
    public shatter(impactVel: Vec3) {
        if (this._shattered) return;
        this._shattered = true;

        const srcMesh = this._renderer ? this._renderer.mesh : null;
        if (!srcMesh || srcMesh.renderingSubMeshes.length === 0) {
            this.destroySelf();
            return;
        }

        const geom = readAllSubmeshes(srcMesh);
        if (geom.indices.length === 0 || geom.positions.length === 0) {
            this.destroySelf();
            return;
        }

        // 顶点/法线变换到世界空间。
        // 注意：mesh 是挂在子节点上的（FBX 导入结构），必须用 MeshRenderer 所在节点的世界矩阵，
        // 否则几何会偏到子节点的局部坐标去。
        const meshNode = this._renderer ? this._renderer.node : this.node;
        transformGeomToWorld(geom, meshNode.worldMatrix, meshNode.worldRotation);

        const pieces = fractureGeom(geom, Math.max(2, Math.round(this.pieceCount)));

        const origMass = this._rigid ? this._rigid.mass : 1;
        const pieceMass = origMass / pieces.length;
        const sharedMat = this._renderer ? this._renderer.sharedMaterial : null;
        const scene = this.node.scene;
        if (!scene) {
            this.destroySelf();
            return;
        }

        for (const piece of pieces) {
            const mesh = utils.MeshUtils.createMesh({
                positions: piece.positions,
                normals: piece.normals,
                uvs: piece.uvs,
                indices: piece.indices,
                primitiveMode: gfx.PrimitiveMode.TRIANGLE_LIST,
            }, undefined, { calculateBounds: true });

            // 节点先建为非激活：若直接以激活态 addComponent(MeshCollider)，
            // onEnable 会在 convex/mesh 尚未设好时用空网格建一次非凸形状，并触发
            // warnID(9630)「动态刚体不允许非凸 Mesh」。属性设好后再激活，
            // onEnable 一次性按 convex=true 建凸包形状，无警告、也省一次空形状。
            const n = new Node('frag');
            n.active = false;
            n.parent = scene;
            n.setWorldPosition(piece.centroid);

            const mr = n.addComponent(MeshRenderer);
            mr.mesh = mesh;
            if (sharedMat) mr.material = sharedMat;

            // 先加刚体，再加碰撞体（同一节点，碰撞体会挂到刚体上）
            const rb = n.addComponent(RigidBody);
            rb.mass = pieceMass;
            rb.allowSleep = true;
            rb.linearDamping = 0.1;   // 线阻尼低：下坠/飞出干净
            rb.angularDamping = 1.0;  // 角阻尼高：停止翻滚/旋转，快速稳定

            const col = n.addComponent(MeshCollider);
            col.convex = true;   // 必须在 mesh 之前设：激活时 onComponentSet 才按凸包建形状
            col.mesh = mesh;

            n.addComponent(FragmentController);

            // 激活：RigidBody.onLoad 创建 bullet body，MeshCollider.onEnable 建凸包形状
            n.active = true;

            // 初速度 = shell 速度一部分 + 随机炸开
            // （必须在激活后设：setLinearVelocity 在 body 未初始化时是 no-op）
            const vel = new Vec3();
            Vec3.multiplyScalar(vel, impactVel, this.transferFactor);
            const scatter = randomUnitVec();
            vel.x += scatter.x * this.scatterForce;
            vel.y += scatter.y * this.scatterForce;
            vel.z += scatter.z * this.scatterForce;
            rb.setLinearVelocity(vel);
            rb.setAngularVelocity(new Vec3(
                (Math.random() - 0.5) * 8,
                (Math.random() - 0.5) * 8,
                (Math.random() - 0.5) * 8,
            ));
            rb.wakeUp();
        }

        // 推迟一帧移除原物体，避免在碰撞回调里销毁节点
        this.destroySelf();
    }

    private destroySelf() {
        this.scheduleOnce(() => {
            if (this.node && this.node.isValid) this.node.destroy();
        }, 0);
    }
}

// ---------------------------------------------------------------------------
// 切分工具
// ---------------------------------------------------------------------------

interface MeshGeom {
    positions: number[];
    normals: number[];
    uvs: number[];
    indices: number[];
}

interface FracturePiece {
    positions: number[];
    normals: number[];
    uvs: number[];
    indices: number[];
    centroid: Vec3; // 世界空间质心（碎片节点放这里）
}

/** 合并所有 submesh 的几何数据（indices 按顶点偏移重排）。
 *  直接从 renderingSubMeshes[i].geometricInfo / mesh.readAttribute 读取 CPU 侧顶点数据，
 *  不走 utils.readMesh：发布构建（web-mobile 导出）下 readMesh 按 mesh.struct 顶点流拼装，
 *  顶点流格式/偏移打包后可能不一致导致读取失败；geometricInfo 走引擎自己的 readAttribute，
 *  正确处理 RGB32F / RGBA32F / 半浮点等格式，拿到的是规范化的 Float32Array。 */
function readAllSubmeshes(mesh: Mesh): MeshGeom {
    const geom: MeshGeom = { positions: [], normals: [], uvs: [], indices: [] };
    const subMeshes = mesh.renderingSubMeshes;
    const count = subMeshes.length;
    let vertexOffset = 0;
    for (let i = 0; i < count; i++) {
        const info = subMeshes[i].geometricInfo;
        const positions = info.positions;
        const indices = info.indices;
        if (!positions || positions.length === 0 || !indices || indices.length === 0) {
            continue; // 无几何数据直接跳过该 submesh
        }
        // 法线/UV 用 readAttribute 单独读取（32F 格式返回 Float32Array，半浮点格式返回原始 Uint16Array，
        // 后者的 bits 不是规范化的 float，不能用，需跳过）
        const normals = mesh.readAttribute(i, gfx.AttributeName.ATTR_NORMAL);
        const uvs = mesh.readAttribute(i, gfx.AttributeName.ATTR_TEX_COORD);
        const hasNormals = !!(normals && normals.BYTES_PER_ELEMENT === 4 && normals.length >= positions.length);
        const hasUvs = !!(uvs && uvs.BYTES_PER_ELEMENT === 4 && uvs.length >= positions.length / 3 * 2);

        const vcount = positions.length / 3;
        for (let vi = 0; vi < vcount; vi++) {
            geom.positions.push(positions[vi * 3], positions[vi * 3 + 1], positions[vi * 3 + 2]);
            if (hasNormals) {
                geom.normals.push(normals[vi * 3], normals[vi * 3 + 1], normals[vi * 3 + 2]);
            }
            if (hasUvs) {
                geom.uvs.push(uvs[vi * 2], uvs[vi * 2 + 1]);
            }
        }
        for (let k = 0; k < indices.length; k++) {
            geom.indices.push(indices[k] + vertexOffset);
        }
        vertexOffset += vcount;
    }
    return geom;
}

/** 把几何数据从节点局部空间变换到世界空间 */
function transformGeomToWorld(geom: MeshGeom, worldMat: Readonly<Mat4>, worldRot: Readonly<Quat>) {
    const p = new Vec3();
    const n = new Vec3();
    for (let i = 0; i < geom.positions.length; i += 3) {
        p.set(geom.positions[i], geom.positions[i + 1], geom.positions[i + 2]);
        Vec3.transformMat4(p, p, worldMat);
        geom.positions[i] = p.x;
        geom.positions[i + 1] = p.y;
        geom.positions[i + 2] = p.z;
    }
    for (let i = 0; i < geom.normals.length; i += 3) {
        n.set(geom.normals[i], geom.normals[i + 1], geom.normals[i + 2]);
        Vec3.transformQuat(n, n, worldRot);
        geom.normals[i] = n.x;
        geom.normals[i + 1] = n.y;
        geom.normals[i + 2] = n.z;
    }
}

/** 递归随机平面切分，得到目标数量左右的三角形块 */
function fractureGeom(geom: MeshGeom, targetCount: number): FracturePiece[] {
    const triCount = Math.floor(geom.indices.length / 3);
    const tris: number[][] = [];
    for (let i = 0; i < triCount; i++) {
        tris.push([geom.indices[i * 3], geom.indices[i * 3 + 1], geom.indices[i * 3 + 2]]);
    }

    const chunks = splitTris(tris, geom.positions, targetCount);

    const pieces: FracturePiece[] = [];
    for (const ctris of chunks) {
        const cg = buildChunkGeom(ctris, geom);
        const centroid = computeCentroid(cg.positions);

        // 把几何平移到原点（碎片节点原点即质心，规避"质心钉在底部"问题）
        const p = new Vec3();
        for (let i = 0; i < cg.positions.length; i += 3) {
            p.set(cg.positions[i], cg.positions[i + 1], cg.positions[i + 2]);
            Vec3.subtract(p, p, centroid);
            cg.positions[i] = p.x;
            cg.positions[i + 1] = p.y;
            cg.positions[i + 2] = p.z;
        }

        // 防御：通道不完整就丢弃，避免 createMesh 越界
        if (cg.normals.length !== cg.positions.length) cg.normals = [];
        if (cg.uvs.length * 3 !== cg.positions.length * 2) cg.uvs = [];

        pieces.push({ ...cg, centroid });
    }
    return pieces;
}

function splitTris(tris: number[][], positions: number[], targetCount: number): number[][][] {
    let chunks: number[][][] = [tris];
    let guard = 0;
    while (chunks.length < targetCount && guard++ < 64) {
        // 取三角形最多的块
        let idx = -1;
        let maxT = -1;
        for (let i = 0; i < chunks.length; i++) {
            if (chunks[i].length > maxT) {
                maxT = chunks[i].length;
                idx = i;
            }
        }
        if (idx < 0 || maxT < 6) break;

        const C = chunks[idx];
        const centroid = computeTriCentroid(C, positions);
        let done = false;
        for (let k = 0; k < 8 && !done; k++) {
            const normal = randomUnitVec();
            const front: number[][] = [];
            const back: number[][] = [];
            for (const t of C) {
                const cx = (positions[t[0] * 3] + positions[t[1] * 3] + positions[t[2] * 3]) / 3;
                const cy = (positions[t[0] * 3 + 1] + positions[t[1] * 3 + 1] + positions[t[2] * 3 + 1]) / 3;
                const cz = (positions[t[0] * 3 + 2] + positions[t[1] * 3 + 2] + positions[t[2] * 3 + 2]) / 3;
                const d = (cx - centroid.x) * normal.x + (cy - centroid.y) * normal.y + (cz - centroid.z) * normal.z;
                if (d >= 0) front.push(t); else back.push(t);
            }
            if (front.length >= 3 && back.length >= 3) {
                chunks.splice(idx, 1, front, back);
                done = true;
            }
        }
        if (!done) break; // 多次随机平面都切不开，放弃（避免死循环）
    }
    return chunks;
}

/** 由三角形块重建独立索引的几何数据 */
function buildChunkGeom(tris: number[][], geom: MeshGeom) {
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const map = new Map<number, number>();

    for (const t of tris) {
        for (const vi of t) {
            let ni = map.get(vi);
            if (ni === undefined) {
                ni = positions.length / 3;
                map.set(vi, ni);
                positions.push(geom.positions[vi * 3], geom.positions[vi * 3 + 1], geom.positions[vi * 3 + 2]);
                if (geom.normals.length >= (vi + 1) * 3) {
                    normals.push(geom.normals[vi * 3], geom.normals[vi * 3 + 1], geom.normals[vi * 3 + 2]);
                }
                if (geom.uvs.length >= (vi + 1) * 2) {
                    uvs.push(geom.uvs[vi * 2], geom.uvs[vi * 2 + 1]);
                }
            }
            indices.push(ni);
        }
    }
    return { positions, normals, uvs, indices };
}

function computeCentroid(positions: number[]): Vec3 {
    const c = new Vec3();
    const n = positions.length / 3;
    if (n === 0) return c;
    for (let i = 0; i < positions.length; i += 3) {
        c.x += positions[i];
        c.y += positions[i + 1];
        c.z += positions[i + 2];
    }
    c.x /= n;
    c.y /= n;
    c.z /= n;
    return c;
}

function computeTriCentroid(tris: number[][], positions: number[]): Vec3 {
    const c = new Vec3();
    const n = tris.length;
    if (n === 0) return c;
    for (const t of tris) {
        c.x += (positions[t[0] * 3] + positions[t[1] * 3] + positions[t[2] * 3]) / 3;
        c.y += (positions[t[0] * 3 + 1] + positions[t[1] * 3 + 1] + positions[t[2] * 3 + 1]) / 3;
        c.z += (positions[t[0] * 3 + 2] + positions[t[1] * 3 + 2] + positions[t[2] * 3 + 2]) / 3;
    }
    c.x /= n;
    c.y /= n;
    c.z /= n;
    return c;
}

/** 均匀分布的随机单位向量（球面） */
function randomUnitVec(): Vec3 {
    const u = Math.random() * 2 - 1;
    const theta = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.max(0, 1 - u * u));
    return new Vec3(r * Math.cos(theta), u, r * Math.sin(theta));
}
