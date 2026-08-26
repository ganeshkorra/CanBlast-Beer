import {
    _decorator, Component, Node, Vec3, Quat, Mat4, Mesh, MeshRenderer, MeshCollider,
    AudioClip, AudioSource, RigidBody, Collider, ICollisionEvent, utils, gfx,
} from 'cc';
import { WorldObjController } from './WorldObjController';

const { ccclass, property } = _decorator;

/**
 * Implementation note.
 *
 * Implementation note.
 * Implementation note.
 *
 * Implementation note.
 * Implementation note.
 */
@ccclass('MeshFracture')
export class MeshFracture extends Component {
    /** Implementation note. */
    private static readonly GROUND_LAYER = 2;

    /** Played once when the beer item lands and breaks apart. */
    @property(AudioClip)
    public fallSound: AudioClip | null = null;

    @property
    public fallSoundVolume = 0.75;

    /** Implementation note. */
    @property({ tooltip: 'Target number of fragments' })
    public pieceCount: number = 6;

    /** Implementation note. */
    @property({ tooltip: 'Portion of impact velocity inherited by fragments' })
    public transferFactor: number = 0.6;

    /** Implementation note. */
    @property({ tooltip: 'Additional random burst speed' })
    public scatterForce: number = 1.5;

    private _shattered = false;
    private _rigid: RigidBody | null = null;
    private _renderer: MeshRenderer | null = null;
    private _collider: Collider | null = null;
    private _audio: AudioSource | null = null;
    private readonly _tmpVel = new Vec3();

    start() {
        this._audio = this.getComponent(AudioSource) || this.addComponent(AudioSource);
        this._rigid = this.getComponent(RigidBody);
        // Implementation note.
        this._renderer = this.getComponent(MeshRenderer) || this.getComponentInChildren(MeshRenderer);
        this._collider = this.getComponent(Collider);
        if (this._collider) {
            // Implementation note.
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
        // Implementation note.
        if ((other.node.layer & MeshFracture.GROUND_LAYER) === 0) return;

        if (this.fallSound && this._audio) this._audio.playOneShot(this.fallSound, this.fallSoundVolume);

        // Implementation note.
        const impactVel = this._tmpVel;
        if (this._rigid) this._rigid.getLinearVelocity(impactVel);
        else impactVel.set(0, 0, 0);

        this.shatter(impactVel);
    }

    /**
     * Implementation note.
     * Implementation note.
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

        // Implementation note.
        // Implementation note.
        // Implementation note.
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

            // Implementation note.
            // Implementation note.
            // Implementation note.
            // Implementation note.
            const n = new Node('frag');
            n.active = false;
            n.parent = scene;
            n.setWorldPosition(piece.centroid);

            const mr = n.addComponent(MeshRenderer);
            mr.mesh = mesh;
            if (sharedMat) mr.material = sharedMat;

            // Implementation note.
            const rb = n.addComponent(RigidBody);
            rb.mass = pieceMass;
            rb.allowSleep = true;
            rb.linearDamping = 0.1;   // Implementation note.
            rb.angularDamping = 1.0;  // Implementation note.

            const col = n.addComponent(MeshCollider);
            col.convex = true;   // Implementation note.
            col.mesh = mesh;

            n.addComponent(WorldObjController);

            // Implementation note.
            n.active = true;

            // Implementation note.
            // Implementation note.
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

        // Implementation note.
        this.destroySelf();
    }

    private destroySelf() {
        this.scheduleOnce(() => {
            if (this.node && this.node.isValid) this.node.destroy();
        }, 0);
    }
}

// ---------------------------------------------------------------------------
// Implementation note.
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
    centroid: Vec3; // Implementation note.
}

/** Read and combine geometry from every submesh. */
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
            continue; // Implementation note.
        }
        // Implementation note.
        // Implementation note.
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

/** Implementation note. */
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

/** Implementation note. */
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

        // Implementation note.
        const p = new Vec3();
        for (let i = 0; i < cg.positions.length; i += 3) {
            p.set(cg.positions[i], cg.positions[i + 1], cg.positions[i + 2]);
            Vec3.subtract(p, p, centroid);
            cg.positions[i] = p.x;
            cg.positions[i + 1] = p.y;
            cg.positions[i + 2] = p.z;
        }

        // Implementation note.
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
        // Implementation note.
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
        if (!done) break; // Implementation note.
    }
    return chunks;
}

/** Implementation note. */
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

/** Implementation note. */
function randomUnitVec(): Vec3 {
    const u = Math.random() * 2 - 1;
    const theta = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.max(0, 1 - u * u));
    return new Vec3(r * Math.cos(theta), u, r * Math.sin(theta));
}
