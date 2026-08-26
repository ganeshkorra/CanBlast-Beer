import { _decorator, Component, Animation } from 'cc';
import { GunShotShim } from './GunShotShim';
const { ccclass } = _decorator;

@ccclass('GunController')
export class GunController extends Component {
    /** shot 帧事件回调：LaunchBall 动画在发射帧（约 0.33s）调用本组件 shot() 方法时触发 */
    public onShot: () => void = null;

    /** 播放 launch 动画；无 Animation 组件时立即触发 onShot 兜底 */
    public playLaunch() {
        const anim = this.getComponentInChildren(Animation);
        if (!anim) {
            if (this.onShot) this.onShot();
            return;
        }

        // 帧事件只在 Animation 所在节点触发（node.invoke('shot')）。
        // 若 GunController 不在该节点上（如 GunController 在 GunBase、Animation 在子节点 Gun），
        // 帧事件找不到 shot()。解决：在 Animation 所在节点动态添加 shim，转发到 GunController。
        const animNode = anim.node;
        if (animNode !== this.node && !animNode.getComponent(GunShotShim)) {
            const shim = animNode.addComponent(GunShotShim);
            shim.init(this);
        }

        anim.play('LaunchBall');
    }

    /** 由 LaunchBall 动画的帧事件（func: "shot"）自动调用 */
    public shot() {
        if (this.onShot) this.onShot();
    }
}
