import { _decorator, Component, Node, tween, Vec3 } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('ScaleInOut')
export class ScaleInOut extends Component {
   onLoad() {
    this.playLoopAnimation();
    }
        
    private playLoopAnimation() {
        tween(this.node)
        .repeatForever(
            tween()
            .to(0.7, { scale: new Vec3(1.43, 1.43, 1.43) })
            .to(0.5, { scale: new Vec3(1.424, 1.424, 1.424) })
        )
        .start();
    }
}


