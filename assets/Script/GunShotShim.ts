import { _decorator, Component } from 'cc';
import { GunController } from './GunController';
const { ccclass } = _decorator;

/**
 * Implementation note.
 * Implementation note.
 */
@ccclass('GunShotShim')
export class GunShotShim extends Component {
    private _controller: GunController | null = null;

    init(controller: GunController) {
        this._controller = controller;
    }

    /** Implementation note. */
    public shot() {
        if (this._controller) {
            this._controller.shot();
        }
    }
}
