import { _decorator, Component, Node, Vec3, Vec2, input, Input, EventTouch, EventMouse, Camera, Canvas, UITransform, RigidBody, Collider, ICollisionEvent, geometry, PhysicsSystem, Layers, Label, Color, Widget, Prefab, instantiate, director, Button } from 'cc';
import { GunController } from './GunController';
const { ccclass, property } = _decorator;

/** 游戏状态 */
enum GameState {
    /** 初始化：进入场景后，不可任何操作，等所有 WORLD_OBJ 静止 */
    INITIALIZING = 'INITIALIZING',
    /** 准备好了：shell 挂在 point 下，可拖动、可点击发射；shell 关闭物理 */
    READY = 'READY',
    /** 发射中：播放 gun 的 launch 动画，shot 事件时发射 shell */
    FIRING = 'FIRING',
    /** 装弹中：不可再次发射，可拖动旋转，延迟后判断胜负 */
    RELOAD = 'RELOAD',
    /** 游戏结束：不可发射、不可拖动 */
    GAME_OVER = 'GAME_OVER',
}

@ccclass('GameLogic')
export class GameLogic extends Component {
    @property(Node)
    public platform: Node = null;
    @property(Prefab)
    public shellPrefab: Prefab = null;
    @property(Node)
    public marker: Node = null;
    @property(Label)
    public ballRemainingLabel: Label = null;
    @property(Node)
    public buttonRetry: Node = null;

    /** 主摄像机，留空则自动查找名为 Main Camera 的节点 */
    @property(Node)
    public mainCamera: Node = null;

    /** 左右拖动的旋转灵敏度（度/像素） */
    @property
    public rotateSpeed: number = 0.1;

    /** 绕 Y 轴旋转的圆心（默认原点 0,0,0） */
    @property
    public orbitCenter: Vec3 = new Vec3(0, 0, 0);

    /** 指针位移小于该像素数视为点击（射线取点），否则视为拖动旋转 */
    @property
    public clickThreshold: number = 10;

    /** 发射力量（shell 初速度大小），可在面板调整 */
    @property
    public firePower: number = 20;

    /** shell point */
    @property(Node)
    public gunPoint: Node = null;

    /** gun 节点（含 GunController 与 LaunchBall 动画），留空则自动找 Main Camera 下的 Gun */
    @property(Node)
    public gun: Node = null;

    /** WORLD_OBJ 线/角速度小于该值（m/s、rad/s）视为静止 */
    @property
    public restSpeed: number = 0.05;

    /** 全部 WORLD_OBJ 静止持续该时长（秒）后才进入下一状态，避免瞬间误判（仅 INITIALIZING 使用） */
    @property
    public restDelay: number = 0.5;

    /** RELOAD 状态持续时长（秒）：发射后等待该时间再判断胜负 */
    @property
    public reloadDelay: number = 1.0;

    /** WORLD_OBJ 世界 Y 坐标低于该值立即删除（掉出平台/悬崖） */
    @property
    public deleteBelowY: number = 0;

    /** shell 与场景中心的水平距离超过该值时自动销毁（防止飞出地图永远不回收） */
    @property
    public shellMaxDistance: number = 50;

    /** WORLD_OBJ 刚体线性阻尼。调大物体会被"空气"托住、下坠迟缓轻飘；调小则自由下坠、干净利落 */
    @property
    public worldObjDamping: number = 0.1;

    /** WORLD_OBJ 刚体角阻尼（独立于线阻尼）：转动/翻滚越快停止，不影响下坠（线速度） */
    @property
    public worldObjAngularDamping: number = 1.0;

    /** WORLD_OBJ 额外的下落重力加速度（m/s²），叠加在物理世界重力(-10)之上。
     *  只作用于 WORLD_OBJ、不影响 shell 弹道；0 = 不叠加 */
    @property
    public worldObjFallGravity: number = 5;

    /** 地面平台世界 Y 坐标（用于启动时 Y 吸附） */
    @property
    public groundY: number = 2.736;

    @property(Label)
    public debugLabel: Label = null;

    /** 剩余可发射球数。每次发射扣 1，用完且未清空全部 WORLD_OBJ 时游戏结束 */
    private _ballRemaining: number = 18;
    private get ballRemaining(): number {
        return this._ballRemaining;
    }
    private set ballRemaining(value: number) {
        this._ballRemaining = value;
        this.ballRemainingLabel.string = value.toString();
    }

    // 轨道参数
    private _radius = 0;          // 摄像机到 orbitCenter 的水平距离
    private _height = 0;          // 摄像机相对 orbitCenter 的高度（保持不变 → 摄像机高度不变）
    private _yaw = 0;             // 当前环绕角（度）
    private _yawInit = 0;         // 初始环绕角
    private _pitch = 0;           // 摄像机初始俯仰角（转台全程保持不变）
    private _roll = 0;            // 摄像机初始滚转角（保持不变）
    private _camYawInit = 0;      // 摄像机初始朝向角（yaw）
    private _active = false;      // 是否正在拖动
    private _pressed = false;     // 指针是否按下
    private _startX = 0;          // 按下时的 x
    private _startY = 0;          // 按下时的 y
    private _lastX = 0;           // 上一次指针的 x 坐标
    private _touchId: number = -1;
    private _markerPlaced = false;                    // 是否已放置 marker
    private readonly _markerWorldPos = new Vec3();    // marker 的世界坐标
    private readonly _tempPos = new Vec3();
    private readonly _tempRay = new geometry.Ray();
    private readonly _tempDir = new Vec3();
    private readonly _tempVel = new Vec3();
    private readonly _tempV = new Vec3();             // 静止检测用临时速度
    private readonly _tempForce = new Vec3();         // 额外下坠力临时向量

    // 状态机
    private _state = GameState.INITIALIZING;          // 当前游戏状态
    private _worldLayer = 1;                          // WORLD_OBJ 层值（start 里按层名解析）
    private _worldObjs: Node[] = [];                  // 当前存活的 WORLD_OBJ 节点
    private _restTimer = 0;                           // 全部静止持续计时（秒）
    private _resultLabel: Label = null;           // WIN / GAME OVER 结算文本（懒创建）
    private _gunCtl: GunController = null;            // gun 上的 GunController 引用
    private _currentShell: Node = null;               // 当前回合的 shell 实例（从 prefab 实例化）

    onLoad() {
        if (!this.mainCamera) {
            this.mainCamera = this.node.scene.getChildByName('Main Camera');
        }
        if (!this.gun && this.mainCamera) {
            this.gun = this.mainCamera.getChildByName('Gun');
        }
        // gunPoint（发射口）：GunBase → Gun → MangSung2 → Point
        if (this.gun) {
            const gun = this.gun.getChildByName('Gun');
            if (gun) {
                const mang = gun.getChildByName('MangSung2');
                if (mang) {
                    const p = mang.getChildByName('Point');
                    if (p) this.gunPoint = p;
                }
            }
        }
        // nameToLayer 返回 bit 索引，左移 1 位得到实际层值（WORLD_OBJ bit=0 → 层值 1）
        this._worldLayer = 1 << Layers.nameToLayer('WORLD_OBJ');
        // GunController 在 GunBase 上（this.gun 就是 GunBase）
        if (this.gun) {
            this._gunCtl = this.gun.getComponent(GunController);
        }
        // 重试按钮：点击重新加载当前场景
        if (this.buttonRetry) {
            this.buttonRetry.active = false;
            this.buttonRetry.on(Node.EventType.TOUCH_END, this.onRetryClicked, this);
        }
    }

    start() {
        // 调试：打印层信息，确认 mask 是否正确
        const layerIdx = Layers.nameToLayer('WORLD_OBJ');
        console.log(`[GameLogic] WORLD_OBJ nameToLayer=${layerIdx}，mask=${this._worldLayer}，bit0=${1 << 0}，bit1=${1 << 1}`);
        const cam = this.mainCamera;
        if (!cam) {
            console.warn('GameLogic: 未找到主摄像机');
            return;
        }

        const camPos = cam.worldPosition;
        const center = this.orbitCenter;

        // 记录摄像机初始欧拉角（转台效果：俯仰/滚转保持不变，朝向随公转同步转动）
        const euler = cam.eulerAngles;
        this._pitch = euler.x;
        this._roll = euler.z;
        this._camYawInit = euler.y;

        // 轨道参数：围绕 orbitCenter（默认原点）的 Y 轴旋转，保持初始高度和距离
        const ox = camPos.x - center.x;
        const oz = camPos.z - center.z;
        this._radius = Math.sqrt(ox * ox + oz * oz);
        this._height = camPos.y - center.y;
        this._yawInit = Math.atan2(ox, oz) * 180 / Math.PI;
        this._yaw = this._yawInit;

        // 注册触屏拖动
        input.on(Input.EventType.TOUCH_START, this.onTouchStart, this);
        input.on(Input.EventType.TOUCH_MOVE, this.onTouchMove, this);
        input.on(Input.EventType.TOUCH_END, this.onTouchEnd, this);
        input.on(Input.EventType.TOUCH_CANCEL, this.onTouchEnd, this);

        // 桌面端鼠标拖拽同样支持
        input.on(Input.EventType.MOUSE_DOWN, this.onMouseDown, this);
        input.on(Input.EventType.MOUSE_MOVE, this.onMouseMove, this);
        input.on(Input.EventType.MOUSE_UP, this.onMouseUp, this);

        // 状态机：初始化 → 等所有 WORLD_OBJ 静止后进入"准备好了"
        this.collectWorldObjs();
        //this.snapWorldObjs();

        this.setGameState(GameState.INITIALIZING);

        this.ballRemaining = 18; // 初始化球数
    }

    onDestroy() {
        input.off(Input.EventType.TOUCH_START, this.onTouchStart, this);
        input.off(Input.EventType.TOUCH_MOVE, this.onTouchMove, this);
        input.off(Input.EventType.TOUCH_END, this.onTouchEnd, this);
        input.off(Input.EventType.TOUCH_CANCEL, this.onTouchEnd, this);

        input.off(Input.EventType.MOUSE_DOWN, this.onMouseDown, this);
        input.off(Input.EventType.MOUSE_MOVE, this.onMouseMove, this);
        input.off(Input.EventType.MOUSE_UP, this.onMouseUp, this);

        if (this.buttonRetry && this.buttonRetry.isValid) {
            this.buttonRetry.off(Node.EventType.TOUCH_END, this.onRetryClicked, this);
        }

        this.destroyCurrentShell();
    }

    /** 初始化/游戏结束 状态下禁止任何指针交互（拖动/点击）；RELOAD 只允许拖动不允许点击 */
    private canInteract(): boolean {
        return this._state !== GameState.INITIALIZING && this._state !== GameState.GAME_OVER;
    }

    private onTouchStart(e: EventTouch) {
        if (!this.canInteract()) return;
        const touch = e.touch;
        this._touchId = touch.getID();
        const p = touch.getLocation();
        this._lastX = p.x;
        this._startX = p.x;
        this._startY = p.y;
        this._active = true;
        this._pressed = true;
    }

    private onTouchMove(e: EventTouch) {
        const touch = e.getTouches().find(t => t.getID() === this._touchId);
        if (!touch) return;
        this.rotateByDeltaX(touch.getLocation().x);
    }

    private onTouchEnd(e: EventTouch) {
        const touch = e.touch;
        if (touch.getID() !== this._touchId) return;
        this._touchId = -1;
        this._active = false;
        this.handleRelease(touch.getLocation(), touch.getUILocation());
    }

    private onMouseDown(e: EventMouse) {
        if (!this.canInteract()) return;
        const p = e.getLocation();
        this._lastX = p.x;
        this._startX = p.x;
        this._startY = p.y;
        this._active = true;
        this._pressed = true;
    }

    private onMouseMove(e: EventMouse) {
        this.rotateByDeltaX(e.getLocation().x);
    }

    private onMouseUp(e: EventMouse) {
        this._active = false;
        this.handleRelease(e.getLocation(), e.getUILocation());
    }

    /** 抬起时判断是否为点击（位移小于阈值），是则射线取点 */
    private handleRelease(screenPos: Vec2, uiPos: Vec2) {
        if (!this._pressed) return;
        this._pressed = false;
        const moved = Math.hypot(screenPos.x - this._startX, screenPos.y - this._startY);
        if (moved < this.clickThreshold) {
            this.handleTap(screenPos, uiPos);
        }
    }

    /** 点击取点：未点到 UI 时用射线检测 WORLD_OBJ，命中则把 marker 放到碰撞点并进入发射流程 */
    private handleTap(screenPos: Vec2, uiPos: Vec2) {
        if (this.isPointOnUI(uiPos)) return;
        if (!this.mainCamera || !this.marker) return;
        // 只有"准备好了"可以点击发射
        if (this._state !== GameState.READY) return;

        const cameraComp = this.mainCamera.getComponent(Camera);
        if (!cameraComp) return;

        const ray = this._tempRay;
        cameraComp.screenPointToRay(screenPos.x, screenPos.y, ray);
        const mask = this._worldLayer; // raycast mask 即层值位掩码（每层占一位）
        if (PhysicsSystem.instance.raycast(ray, mask, 300)) {
            // 后过滤：bullet 的 mask 按碰撞组过滤，可能命中非 WORLD_OBJ 节点，
            // 需再检查 node.layer 确保只命中 WORLD_OBJ
            const results = PhysicsSystem.instance.raycastResults;
            let hit: typeof results[0] | null = null;
            for (const r of results) {
                if ((r.collider.node.layer & this._worldLayer) !== 0) {
                    hit = r;
                    break;
                }
            }
            if (!hit) return; // 没有命中 WORLD_OBJ

            console.log(`[raycast] 命中 ${hit.collider.node.name}，node.layer=${hit.collider.node.layer}，点 ${hit.hitPoint.toString()}`);
            this._markerPlaced = true;
            this._markerWorldPos.set(hit.hitPoint);
            this.marker.setWorldPosition(this._markerWorldPos);
            // 命中 WORLD_OBJ：进入"发射中"（播放 launch 动画，shot 事件时真正发射）
            this.startFire();
        }
    }

    /** 进入"发射中"：GunBase Y 轴旋转对准目标，播放 gun 的 launch 动画，shot 帧事件到达时发射 shell */
    private startFire() {
        this.setGameState(GameState.FIRING);

        // GunBase 是摄像机的子节点，旋转在摄像机本地空间。
        // 摄像机始终朝向 orbitCenter（Y 轴上某点），
        // GunBase 的 Y 旋转 = 目标方向与摄像机朝向的夹角（摄像机本地空间）。
        if (this.gun && this.mainCamera) {
            const gunPos = this.gun.worldPosition;
            const dx = this._markerWorldPos.x - gunPos.x;
            const dz = this._markerWorldPos.z - gunPos.z;
            // 目标相对 +Z 的世界角度
            const targetWorldAngle = Math.atan2(dx, dz) * 180 / Math.PI;
            // 摄像机当前 Y 世界旋转（= yaw）
            const camYaw = this.mainCamera.eulerAngles.y;
            // GunBase 本地角度 = 世界角度 - 摄像机 yaw
            const localAngle = targetWorldAngle - camYaw + 180;
            this.gun.setRotationFromEuler(0, localAngle, 0);
            console.log(`target=${targetWorldAngle.toFixed(1)} camYaw=${camYaw.toFixed(1)} local=${localAngle.toFixed(1)}`);
        }

        if (this._gunCtl) {
            this._gunCtl.onShot = () => this.doFire();
            this._gunCtl.playLaunch();
        } else {
            // 没有 GunController/动画时跳过动画直接发射
            this.doFire();
        }
    }

    /** shot 事件：解除 shell 的 point 父节点，向 marker 方向发射（初速度大小 = firePower） */
    private doFire() {
        if (this._state !== GameState.FIRING) return; // 只有"发射中"才能发射
        if (!this._currentShell || !this.gunPoint || !this._markerPlaced) {
            this.setGameState(GameState.RELOAD); // 无法发射也进入装弹
            return;
        }

        // 发射起点：point 的世界位置（此时 launch 动画已把枪口拉到发射姿态）
        const gunPos = this.gunPoint.worldPosition;

        // 解除父节点 point，挂回 World 下（避免随摄像机公转而移动）
        if (this._currentShell.parent !== this.node) {
            this._currentShell.setParent(this.node);
        }
        this._currentShell.setWorldPosition(gunPos);

        const rigid = this._currentShell.getComponent(RigidBody);
        if (!rigid) {
            this.setGameState(GameState.RELOAD);
            return;
        }

        // 打开物理：重新启用刚体与碰撞体（上膛时已关闭），此后才能设置速度
        this.enableShellPhysics();

        // 高速弹体开启连续碰撞检测（CCD）：bullet 按运动轨迹扫掠检测，
        // 避免单步进内穿过物体（隧道效应）。速度越快越需要。
        // 注意：useCCD 仅在刚体初始化完成后生效，因此必须在 enabled 之后设置
        rigid.useCCD = true;

        // 清零阻尼：避免场景里残留的 0.9 线性阻尼把弹速拖垮（无空气阻力，飞行更干净利落）
        rigid.linearDamping = 0;
        rigid.angularDamping = 0;

        // 方向：枪口 → marker
        Vec3.subtract(this._tempDir, this._markerWorldPos, gunPos);
        if (this._tempDir.lengthSqr() < 0.0001) {
            this.setGameState(GameState.RELOAD); // 枪口就在 marker 上，不发射
            return;
        }
        this._tempDir.normalize();

        rigid.setLinearVelocity(Vec3.multiplyScalar(this._tempVel, this._tempDir, this.firePower));
        rigid.setAngularVelocity(Vec3.ZERO);

        // 每次真实发射消耗一个球（所有前置失败分支都已 return，这里必然发射成功）
        this.ballRemaining--;
        console.log(`[GameLogic] 剩余球数：${this.ballRemaining}`);

        // 发射完成，进入"装弹中"
        this.collectWorldObjs();
        this.setGameState(GameState.RELOAD);
    }

    /** 进入"准备好了"：从 prefab 实例化新 shell，挂到 point 节点下，可拖动、可点击发射；球用完则直接游戏结束 */
    private enterReady() {
        if (this.ballRemaining <= 0) {
            // 兜底：球数为 0 时不应再回到"准备好了"
            this.showLose();
            this.setGameState(GameState.GAME_OVER);
            return;
        }
        // 实例化新 shell
        this._currentShell = this.instantiateShell();
        if (!this._currentShell) {
            console.warn('GameLogic: shellPrefab 实例化失败');
            this.showLose();
            this.setGameState(GameState.GAME_OVER);
            return;
        }
        this.setGameState(GameState.READY);
        this.attachShellToPoint();
    }

    /** 从 shellPrefab 实例化一个新 shell 节点，挂到 World 下，关闭物理，监听碰撞 */
    private instantiateShell(): Node | null {
        if (!this.shellPrefab) return null;
        const shell = instantiate(this.shellPrefab);
        shell.parent = this.node;  // 挂到 World 下

        // 监听首次碰撞：发射时重力已关闭，碰到物体时再开启
        const col = shell.getComponent(Collider);
        if (col) {
            col.on('onCollisionEnter', this.onShellCollision, this);
        }

        return shell;
    }

    /** 关闭 shell 物理：禁用 RigidBody 与同节点的 Collider（否则 shape 仍在，body 不会从物理世界移除，重力依旧生效） */
    private disableShellPhysics() {
        if (!this._currentShell) return;
        // 先移除 shape 再移除 body：SharedBody 只有在无 shape 且 body 禁用时才会真正移出物理世界
        const collider = this._currentShell.getComponent(Collider);
        if (collider) collider.enabled = false;
        const rigid = this._currentShell.getComponent(RigidBody);
        if (rigid) rigid.enabled = false;
    }

    /** 打开 shell 物理：重新启用 RigidBody 与 Collider */
    private enableShellPhysics() {
        if (!this._currentShell) return;
        const rigid = this._currentShell.getComponent(RigidBody);
        if (rigid) rigid.enabled = true;
        const collider = this._currentShell.getComponent(Collider);
        if (collider) collider.enabled = true;
    }

    /** shell 首次碰撞：碰到任何物体时开启重力（发射时重力已关闭，直线飞行） */
    private onShellCollision(_e: ICollisionEvent) {
        const rigid = this._currentShell ? this._currentShell.getComponent(RigidBody) : null;
        if (rigid && !rigid.useGravity) {
            rigid.useGravity = true;
        }
    }

    /** 把 shell 挂到 point 节点下（本地归零即落在枪口点），并关闭物理 */
    private attachShellToPoint() {
        if (!this._currentShell || !this.gunPoint) return;
        if (this._currentShell.parent !== this.gunPoint) {
            this._currentShell.setParent(this.gunPoint);
        }
        this._currentShell.setPosition(Vec3.ZERO);
        this._currentShell.setRotationFromEuler(0, 0, 0);
        this._currentShell.setScale(Vec3.ONE);

        // 关闭物理：挂枪状态不参与模拟（不掉落、不碰撞），发射瞬间再打开
        this.disableShellPhysics();
    }

    /** 结算：RELOAD 延迟后触发。
     *  数量为 0 → WIN；否则球已用完 → LOSE；否则下一轮（会实例化新 shell） */
    private settle() {
        this.collectWorldObjs();
        // 结算时销毁当前 shell（无论胜负，旧 shell 已完成使命）
        this.destroyCurrentShell();
        if (this.countWorldObjs() === 0) {
            this.showWin();
            this.setGameState(GameState.GAME_OVER);
        } else if (this.ballRemaining <= 0) {
            // 球用完但仍有 WORLD_OBJ → 失败
            this.showLose();
            this.setGameState(GameState.GAME_OVER);
        } else {
            this.enterReady();
        }
    }

    /** 当前存活的 WORLD_OBJ 数量 */
    private countWorldObjs(): number {
        let count = 0;
        for (const n of this._worldObjs) {
            if (n.isValid && n.active && (n.layer & this._worldLayer) !== 0) count++;
        }
        return count;
    }

    /** 所有 WORLD_OBJ 的线/角速度是否都小于 restSpeed */
    private allWorldObjsRest(): boolean {
        // const restSqr = this.restSpeed * this.restSpeed;
        // const v = this._tempV;
        // for (const n of this._worldObjs) {
        //     if (!n.isValid || !n.active) continue;
        //     const rb = n.getComponent(RigidBody);
        //     if (!rb) continue;
        //     rb.getLinearVelocity(v);
        //     if (v.lengthSqr() > restSqr){
        //         if (this.debugLabel)this.debugLabel.string = `${n.name} ${n.position.x.toFixed(2)},${n.position.y.toFixed(2)},${n.position.z.toFixed(2)} v ${v.length().toFixed(3)} > ${this.restSpeed}`;
        //         return false;
        //     }
        //     // rb.getAngularVelocity(v);
        //     // if (v.lengthSqr() > restSqr) return false;
        // }
        // if (this.debugLabel)this.debugLabel.string = "";
        return true;
    }

    /** 重新收集 World 下当前挂有 RigidBody 的 WORLD_OBJ 节点 */
    private collectWorldObjs() {
        this._worldObjs = this.node.children.filter(n => (n.layer & this._worldLayer) !== 0);
        // 统一 WORLD_OBJ 刚体参数（覆盖场景里残留的 0.9/0.5 大阻尼）：
        // 线阻尼低 → 自由落体干净利落；角阻尼独立调高 → 翻滚/旋转快速停（不影响下落）
        for (const n of this._worldObjs) {
            const rb = n.getComponent(RigidBody);
            if (rb) {
                rb.linearDamping = this.worldObjDamping;
                rb.angularDamping = this.worldObjAngularDamping;
            }
        }
    }

    /** 按碰撞体尺寸自动吸附 WORLD_OBJ 位置，消除垂直缝隙。
     *  同列（X/Z 相近）物体从底部开始堆叠，每个物体的 Y = 下方物体顶部 + 自身半高。 */
    private snapWorldObjs() {
        if (this._worldObjs.length === 0) return;

        // 1. 按 X/Z 分组（距离 < 0.5m 视为同列）
        const groups: Node[][] = [];
        for (const n of this._worldObjs) {
            let placed = false;
            for (const g of groups) {
                const rep = g[0];
                if (Math.abs(n.position.x - rep.position.x) < 0.5 &&
                    Math.abs(n.position.z - rep.position.z) < 0.5) {
                    g.push(n);
                    placed = true;
                    break;
                }
            }
            if (!placed) groups.push([n]);
        }

        // 2. 每列按 Y 排序，从底部开始吸附
        for (const g of groups) {
            g.sort((a, b) => a.position.y - b.position.y);
            let stackY = this.groundY;
            for (const n of g) {
                // 用节点缩放估算半高（碰撞体 worldBounds 在启动时不可靠）
                const sy = Math.max(n.scale.y, 0.1);
                const halfH = 0.5 * sy; // 默认模型高度 1m，乘以 Y 缩放
                // 吸附：设 Y 使物体底部对齐 stackY，留 0.02m 间隙避免重叠碰撞
                const wp = n.worldPosition;
                n.setWorldPosition(wp.x, stackY + halfH, wp.z);
                stackY += halfH * 2 + 0.02;
            }
        }
    }

    /** 给 WORLD_OBJ 动态刚体每帧叠加向下的额外重力（等效提高下落加速度，不影响 shell 弹道） */
    private applyExtraGravity() {
        if (this.worldObjFallGravity === 0) return;
        const f = this._tempForce;
        for (const n of this._worldObjs) {
            if (!n.isValid || !n.active) continue;
            const rb = n.getComponent(RigidBody);
            if (!rb || !rb.isDynamic) continue;
            f.set(0, -this.worldObjFallGravity * rb.mass, 0);  // a = F/m = extraG，与质量无关
            rb.applyForce(f);
        }
    }

    /** 掉出世界：WORLD_OBJ 世界 Y 低于 deleteBelowY 时立即删除 */
    private checkOutOfBounds() {
        if (this._worldObjs.length === 0) return;
        for (const n of this._worldObjs) {
            if (!n.isValid) continue;
            if (n.worldPosition.y < this.deleteBelowY) {
                n.destroy(); // 删除后 isInvalid，静止检测/计数自动跳过
            }
        }
    }

    /** shell 出界自动销毁：离场景中心水平距离超过 shellMaxDistance 或 Y 低于 deleteBelowY */
    private checkShellOutOfBounds() {
        if (!this._currentShell || !this._currentShell.isValid) return;
        // FIRING/RELOAD 时检测（READY 阶段 shell 挂在枪口上不动，不需要检测）
        if (this._state !== GameState.FIRING && this._state !== GameState.RELOAD) return;
        const pos = this._currentShell.worldPosition;
        const cx = this.orbitCenter.x;
        const cz = this.orbitCenter.z;
        const dx = pos.x - cx;
        const dz = pos.z - cz;
        const horizDist = Math.sqrt(dx * dx + dz * dz);
        if (horizDist > this.shellMaxDistance || pos.y < this.deleteBelowY) {
            console.log(`[GameLogic] shell 出界销毁（水平距离 ${horizDist.toFixed(1)}，Y ${pos.y.toFixed(1)}）`);
            this.destroyCurrentShell();
        }
    }

    /** 销毁当前 shell 实例：取消碰撞监听后销毁节点 */
    private destroyCurrentShell() {
        if (!this._currentShell) return;
        const col = this._currentShell.getComponent(Collider);
        if (col) {
            col.off('onCollisionEnter', this.onShellCollision, this);
        }
        this._currentShell.destroy();
        this._currentShell = null;
    }

    /** 设置游戏状态并打印日志（进入新状态时重置静止计时） */
    private setGameState(s: GameState) {
        if (this._state === s) return;
        this._state = s;
        this._restTimer = 0;
        console.log(`[GameLogic] 状态：${s}`);
        // 游戏结束时显示重试按钮，其他状态隐藏
        if (this.buttonRetry) {
            this.buttonRetry.active = s === GameState.GAME_OVER;
        }
    }

    /** 过关：在 CanvasUI 下显示 WIN 文本 */
    private showWin() {
        this.showResult('WIN', new Color(255, 215, 0, 255)); // 金色
    }

    /** 球用完未清场：在 CanvasUI 下显示 LOSE 文本 */
    private showLose() {
        this.showResult('LOSE', new Color(255, 80, 80, 255)); // 红色
    }

    /** 在 CanvasUI 下显示居中结算文本（懒创建，可复用） */
    private showResult(text: string, color: Color) {
        const canvas = this.node.scene.getChildByName('CanvasUI');
        if (!canvas) return;
        if (!this._resultLabel) {
            const n = new Node('ResultText');
            n.layer = Layers.Enum.UI_2D;
            n.parent = canvas;

            const ui = n.addComponent(UITransform);
            ui.setContentSize(800, 240);

            const label = n.addComponent(Label);
            label.fontSize = 160;
            label.lineHeight = 160;
            this._resultLabel = label;

            // 相对画布居中
            const widget = n.addComponent(Widget);
            widget.isAlignHorizontalCenter = true;
            widget.isAlignVerticalCenter = true;
            widget.alignMode = Widget.AlignMode.ON_WINDOW_RESIZE;
            n.setPosition(0, 0, 0);
        }
        this._resultLabel.string = text;
        this._resultLabel.color = color;
        this._resultLabel.node.active = true;
    }

    /** 点击重试按钮：重新加载当前场景 */
    private onRetryClicked() {
        const sceneName = director.getScene().name;
        director.loadScene("demo");
    }

    /** 判断 UI 坐标是否落在 CanvasUI 下的某个 UI 元素上（画布背景不算） */
    private isPointOnUI(uiPos: Vec2): boolean {
        const canvas = this.node.scene.getChildByName('CanvasUI');
        if (!canvas) return false;
        return this.uiHitTest(canvas, uiPos);
    }

    private uiHitTest(node: Node, p: Vec2): boolean {
        if (!node.getComponent(Canvas)) {
            const ui = node.getComponent(UITransform);
            if (ui && ui.hitTest(p)) {
                return true;
            }
        }
        for (const child of node.children) {
            if (this.uiHitTest(child, p)) return true;
        }
        return false;
    }

    /** 根据指针位移累加环绕角（向左拖动 → 视角顺时针，向右 → 逆时针） */
    private rotateByDeltaX(x: number) {
        if (!this._active) return;
        const deltaX = x - this._lastX;
        this._lastX = x;
        this._yaw -= deltaX * this.rotateSpeed;
    }

    update(dt: number) {
        const cam = this.mainCamera;
        if (cam) {
            const center = this.orbitCenter;
            const rad = this._yaw * Math.PI / 180;
            // 围绕 orbitCenter 的 Y 轴公转，高度恒定
            this._tempPos.set(
                center.x + Math.sin(rad) * this._radius,
                center.y + this._height,   // 高度恒定 → 摄像机高度不变
                center.z + Math.cos(rad) * this._radius,
            );
            cam.setWorldPosition(this._tempPos);

            // 转台效果：朝向随公转同步转动，保持初始俯仰/滚转，始终正对场景中心区域
            const camYaw = this._camYawInit + (this._yaw - this._yawInit);
            cam.setWorldRotationFromEuler(this._pitch, camYaw, this._roll);

            // marker 是摄像机的子节点，摄像机移动后重新钉回命中的世界坐标，使其保持在物体上
            if (this._markerPlaced && this.marker) {
                this.marker.setWorldPosition(this._markerWorldPos);
            }
        }

        // WORLD_OBJ 额外下坠力（提高下落速度）
        this.applyExtraGravity();

        // 掉出世界（Y 低于阈值）的 WORLD_OBJ 立即删除
        this.checkOutOfBounds();

        // shell 出界自动销毁（发射中/等待静止时检测）
        this.checkShellOutOfBounds();

        // 状态机流转
        switch (this._state) {
            case GameState.INITIALIZING:
                // 所有 WORLD_OBJ 静止并保持 restDelay 秒后 → "准备好了"
                if (this.allWorldObjsRest()) {
                    this._restTimer += dt;
                    if (this._restTimer >= this.restDelay) this.enterReady();
                } else {
                    this._restTimer = 0;
                }
                break;

            case GameState.RELOAD:
                // 固定延迟后结算：销毁 shell → 判断 WIN/LOSE 或下一轮
                this._restTimer += dt;
                if (this._restTimer >= this.reloadDelay) {
                    this.settle();
                }
                break;

            case GameState.READY:
            case GameState.FIRING:
            case GameState.GAME_OVER:
                break;
        }
    }
}

