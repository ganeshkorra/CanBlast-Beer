import { _decorator, Component, Animation } from 'cc';
import { GunShotShim } from './GunShotShim';
const { ccclass } = _decorator;

@ccclass('GunController')
export class GunController extends Component {
    /** Implementation note. */
    public onShot: () => void = null;

    /** Implementation note. */
    public playLaunch() {
        const anim = this.getComponentInChildren(Animation);
        if (!anim) {
            if (this.onShot) this.onShot();
            return;
        }

        // Implementation note.
        // Implementation note.
        // Implementation note.
        const animNode = anim.node;
        if (animNode !== this.node && !animNode.getComponent(GunShotShim)) {
            const shim = animNode.addComponent(GunShotShim);
            shim.init(this);
        }

        anim.play('LaunchBall');
    }

    /** Implementation note. */
    public shot() {
        if (this.onShot) this.onShot();
    }
}
