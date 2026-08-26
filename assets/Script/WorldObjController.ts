import { _decorator, AudioClip, AudioSource, Component, Vec3, tween, MeshRenderer, Material, Color, Collider, ICollisionEvent } from 'cc';
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
@ccclass('WorldObjController')
export class WorldObjController extends Component {
    /** Implementation note. */
    private static readonly GROUND_LAYER = 2;

    /** Played once when this item lands on the ground. */
    @property(AudioClip)
    public fallSound: AudioClip | null = null;

    @property
    public fallSoundVolume = 0.75;

    /** Implementation note. */
    private delayBeforeFade: number = 1;

    /** Implementation note. */
    private fadeDuration: number = 1;

    private _collider: Collider | null = null;
    private _audio: AudioSource | null = null;
    private _groundHit = false;
    private _fading = false;
    private _delayTimer = 0;

    start() {
        this._audio = this.getComponent(AudioSource) || this.addComponent(AudioSource);
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
        if (this._fading || this._groundHit) return;
        const other = event.otherCollider;
        if (!other) return;
        // Implementation note.
        if ((other.node.layer & WorldObjController.GROUND_LAYER) === 0) return;
        this._groundHit = true;
        if (this.fallSound && this._audio) this._audio.playOneShot(this.fallSound, this.fallSoundVolume);
    }

    update(dt: number) {
        if (this._fading || !this._groundHit) return;
        this._delayTimer += dt;
        if (this._delayTimer >= this.delayBeforeFade) {
            this.startFadeOut();
        }
    }

    /** Implementation note. */
    private startFadeOut() {
        if (this._fading) return;
        this._fading = true;

        // Implementation note.
        const renderer = this.getComponentInChildren(MeshRenderer);
        let mat: Material | null = null;
        if (renderer) {
            mat = renderer.material; // Implementation note.
            try {
                mat.recompileShaders({ USE_TRANSPARENCY: true });
            } catch (e) {
                // Implementation note.
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
                        // Implementation note.
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
