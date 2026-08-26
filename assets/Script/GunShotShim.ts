import { _decorator, Component } from 'cc';
import { GunController } from './GunController';
const { ccclass } = _decorator;

/**
 * 运行时动态添加到 Animation 所在节点的 shim 组件。
 * 帧事件 func:"shot" 会在该节点找 shot() 方法 → shim.shot() → 转发到 GunController。
 */
@ccclass('GunShotShim')
export class GunShotShim extends Component {
    private _controller: GunController | null = null;

    init(controller: GunController) {
        this._controller = controller;
    }

    /** 帧事件 func:"shot" 调用此方法 */
    public shot() {
        if (this._controller) {
            this._controller.shot();
        }
    }
}
