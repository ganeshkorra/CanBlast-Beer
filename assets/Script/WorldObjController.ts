import { _decorator, Component, Vec3, tween, MeshRenderer, Material, Color, Collider, ICollisionEvent } from 'cc';
const { ccclass, property } = _decorator;

/**
 * WORLD_OBJ 控制：撞到 GROUND 层后延迟一小段再淡出删除。
 *
 * 用法：挂到有 Collider + RigidBody + MeshRenderer 的 WORLD_OBJ 节点上（MeshRenderer 在子节点上也会被找到），
 * 例如 stone2 / stone3 / ironbox1 / box1 / beer 等。
 *
 * 前提：场景里 GROUND 层的节点必须带物理碰撞体（如 demo.scene 的 ground 节点有 MeshCollider），
 * 否则落地不会触发 onCollisionEnter，也就不会淡出。
 */
@ccclass('WorldObjController')
export class WorldObjController extends Component {
    /** GROUND 层位值（见 settings/v2/packages/project.json 的 layer 配置：GROUND = 2） */
    private static readonly GROUND_LAYER = 2;

    /** 碰到 GROUND 后延迟多久开始淡出（秒） */
    private delayBeforeFade: number = 1;

    /** 淡出时长（秒） */
    private fadeDuration: number = 1;

    private _collider: Collider | null = null;
    private _groundHit = false;
    private _fading = false;
    private _delayTimer = 0;

    start() {
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
        if (this._fading || this._groundHit) return;
        const other = event.otherCollider;
        if (!other) return;
        // 只有撞到 GROUND 层才触发：落地后延迟 delayBeforeFade 秒再淡出
        if ((other.node.layer & WorldObjController.GROUND_LAYER) === 0) return;
        this._groundHit = true;
    }

    update(dt: number) {
        if (this._fading || !this._groundHit) return;
        this._delayTimer += dt;
        if (this._delayTimer >= this.delayBeforeFade) {
            this.startFadeOut();
        }
    }

    /** 淡出 fadeDuration 秒后删除自身 */
    private startFadeOut() {
        if (this._fading) return;
        this._fading = true;

        // FBX 导入后 MeshRenderer 挂在子节点上，用 getComponentInChildren 找到真正的渲染器
        const renderer = this.getComponentInChildren(MeshRenderer);
        let mat: Material | null = null;
        if (renderer) {
            mat = renderer.material; // 取材质实例，只影响本物体
            try {
                mat.recompileShaders({ USE_TRANSPARENCY: true });
            } catch (e) {
                // 材质不支持透明时退化为缩放淡出
            }
        }

        const startScale = this.node.scale.clone();
        const tmpColor = new Color(255, 255, 255, 255);
        const tmpScale = new Vec3();

        tween(this)
            .to(this.fadeDuration, {}, {
                onUpdate: (_target, ratio) => {
                    if (!this.node.isValid) return;
                    const a = 1 - ratio; // 1 → 0
                    if (mat) {
                        // 只改 mainColor 的 a 通道即可实现半透明（RGB 保持 255,255,255）
                        tmpColor.a = Math.round(255 * a);
                        mat.setProperty('mainColor', tmpColor);
                    }
                },
            })
            .call(() => {
                this.node.destroy();
            })
            .start();
    }
}
