import { _decorator, Component, Node, Vec3, Vec2, input, Input, EventTouch, EventMouse, Camera, Canvas, UITransform, RigidBody, Collider, ICollisionEvent, geometry, PhysicsSystem, Layers, Label, Color, Widget, Prefab, instantiate, director, Button } from 'cc';
import { GunController } from './GunController';
const { ccclass, property } = _decorator;

/** Implementation note. */
enum GameState {
    /** Implementation note. */
    INITIALIZING = 'INITIALIZING',
    /** Implementation note. */
    READY = 'READY',
    /** Implementation note. */
    FIRING = 'FIRING',
    /** Implementation note. */
    RELOAD = 'RELOAD',
    /** Implementation note. */
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

    /** Implementation note. */
    @property(Node)
    public mainCamera: Node = null;

    /** Implementation note. */
    @property
    public rotateSpeed: number = 0.1;

    /** Implementation note. */
    @property
    public orbitCenter: Vec3 = new Vec3(0, 0, 0);

    /** Implementation note. */
    @property
    public clickThreshold: number = 10;

    /** Implementation note. */
    @property
    public firePower: number = 20;

    /** shell point */
    @property(Node)
    public gunPoint: Node = null;

    /** Implementation note. */
    @property(Node)
    public gun: Node = null;

    /** Implementation note. */
    @property
    public restSpeed: number = 0.05;

    /** Implementation note. */
    @property
    public restDelay: number = 0.5;

    /** Implementation note. */
    @property
    public reloadDelay: number = 1.0;

    /** Implementation note. */
    @property
    public deleteBelowY: number = 0;

    /** Implementation note. */
    @property
    public shellMaxDistance: number = 50;

    /** Implementation note. */
    @property
    public worldObjDamping: number = 0.1;

    /** Implementation note. */
    @property
    public worldObjAngularDamping: number = 1.0;

    /** Extra downward acceleration applied only to WORLD_OBJ rigid bodies. */
    @property
    public worldObjFallGravity: number = 5;

    /** Implementation note. */
    @property
    public groundY: number = 2.736;

    @property(Label)
    public debugLabel: Label = null;

    /** Implementation note. */
    private _ballRemaining: number = 18;
    private get ballRemaining(): number {
        return this._ballRemaining;
    }
    private set ballRemaining(value: number) {
        this._ballRemaining = value;
        this.ballRemainingLabel.string = value.toString();
    }

    // Implementation note.
    private _radius = 0;          // Implementation note.
    private _height = 0;          // Implementation note.
    private _yaw = 0;             // Implementation note.
    private _yawInit = 0;         // Implementation note.
    private _pitch = 0;           // Implementation note.
    private _roll = 0;            // Implementation note.
    private _camYawInit = 0;      // Implementation note.
    private _active = false;      // Implementation note.
    private _pressed = false;     // Implementation note.
    private _startX = 0;          // Implementation note.
    private _startY = 0;          // Implementation note.
    private _lastX = 0;           // Implementation note.
    private _touchId: number = -1;
    private _markerPlaced = false;                    // Implementation note.
    private readonly _markerWorldPos = new Vec3();    // Implementation note.
    private readonly _tempPos = new Vec3();
    private readonly _tempRay = new geometry.Ray();
    private readonly _tempDir = new Vec3();
    private readonly _tempVel = new Vec3();
    private readonly _tempV = new Vec3();             // Implementation note.
    private readonly _tempForce = new Vec3();         // Implementation note.

    // Implementation note.
    private _state = GameState.INITIALIZING;          // Implementation note.
    private _worldLayer = 1;                          // Implementation note.
    private _worldObjs: Node[] = [];                  // Implementation note.
    private _restTimer = 0;                           // Implementation note.
    private _resultLabel: Label = null;           // Implementation note.
    private _gunCtl: GunController = null;            // Implementation note.
    private _currentShell: Node = null;               // Implementation note.

    onLoad() {
        if (!this.mainCamera) {
            this.mainCamera = this.node.scene.getChildByName('Main Camera');
        }
        if (!this.gun && this.mainCamera) {
            this.gun = this.mainCamera.getChildByName('Gun');
        }
        // Implementation note.
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
        // Implementation note.
        this._worldLayer = 1 << Layers.nameToLayer('WORLD_OBJ');
        // Implementation note.
        if (this.gun) {
            this._gunCtl = this.gun.getComponent(GunController);
        }
        // Implementation note.
        if (this.buttonRetry) {
            this.buttonRetry.active = false;
            this.buttonRetry.on(Node.EventType.TOUCH_END, this.onRetryClicked, this);
        }
    }

    start() {
        // Implementation note.
        const layerIdx = Layers.nameToLayer('WORLD_OBJ');
        console.log(`[GameLogic] WORLD_OBJ nameToLayer=${layerIdx}; mask=${this._worldLayer}; bit0=${1 << 0}; bit1=${1 << 1}`);
        const cam = this.mainCamera;
        if (!cam) {
            console.warn('GameLogic: Main Camera not found');
            return;
        }

        const camPos = cam.worldPosition;
        const center = this.orbitCenter;

        // Store the camera's initial Euler angles. During orbiting, pitch and roll remain fixed while yaw follows the camera.
        const euler = cam.eulerAngles;
        this._pitch = euler.x;
        this._roll = euler.z;
        this._camYawInit = euler.y;

        // Implementation note.
        const ox = camPos.x - center.x;
        const oz = camPos.z - center.z;
        this._radius = Math.sqrt(ox * ox + oz * oz);
        this._height = camPos.y - center.y;
        this._yawInit = Math.atan2(ox, oz) * 180 / Math.PI;
        this._yaw = this._yawInit;

        // Implementation note.
        input.on(Input.EventType.TOUCH_START, this.onTouchStart, this);
        input.on(Input.EventType.TOUCH_MOVE, this.onTouchMove, this);
        input.on(Input.EventType.TOUCH_END, this.onTouchEnd, this);
        input.on(Input.EventType.TOUCH_CANCEL, this.onTouchEnd, this);

        // Implementation note.
        input.on(Input.EventType.MOUSE_DOWN, this.onMouseDown, this);
        input.on(Input.EventType.MOUSE_MOVE, this.onMouseMove, this);
        input.on(Input.EventType.MOUSE_UP, this.onMouseUp, this);

        // Implementation note.
        this.collectWorldObjs();
        //this.snapWorldObjs();

        this.setGameState(GameState.INITIALIZING);

        this.ballRemaining = 18; // Implementation note.
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

    /** Implementation note. */
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

    /** Implementation note. */
    private handleRelease(screenPos: Vec2, uiPos: Vec2) {
        if (!this._pressed) return;
        this._pressed = false;
        const moved = Math.hypot(screenPos.x - this._startX, screenPos.y - this._startY);
        if (moved < this.clickThreshold) {
            this.handleTap(screenPos, uiPos);
        }
    }

    /** Implementation note. */
    private handleTap(screenPos: Vec2, uiPos: Vec2) {
        if (this.isPointOnUI(uiPos)) return;
        if (!this.mainCamera || !this.marker) return;
        // Implementation note.
        if (this._state !== GameState.READY) return;

        const cameraComp = this.mainCamera.getComponent(Camera);
        if (!cameraComp) return;

        const ray = this._tempRay;
        cameraComp.screenPointToRay(screenPos.x, screenPos.y, ray);
        const mask = this._worldLayer; // Implementation note.
        if (PhysicsSystem.instance.raycast(ray, mask, 300)) {
            // Implementation note.
            // Implementation note.
            const results = PhysicsSystem.instance.raycastResults;
            let hit: typeof results[0] | null = null;
            for (const r of results) {
                if ((r.collider.node.layer & this._worldLayer) !== 0) {
                    hit = r;
                    break;
                }
            }
            if (!hit) return; // Implementation note.

            console.log(`[raycast] Hit ${hit.collider.node.name}; node.layer=${hit.collider.node.layer}; point=${hit.hitPoint.toString()}`);
            this._markerPlaced = true;
            this._markerWorldPos.set(hit.hitPoint);
            this.marker.setWorldPosition(this._markerWorldPos);
            // Implementation note.
            this.startFire();
        }
    }

    /** Implementation note. */
    private startFire() {
        this.setGameState(GameState.FIRING);

        // Implementation note.
        // Implementation note.
        // Implementation note.
        if (this.gun && this.mainCamera) {
            const gunPos = this.gun.worldPosition;
            const dx = this._markerWorldPos.x - gunPos.x;
            const dz = this._markerWorldPos.z - gunPos.z;
            // Implementation note.
            const targetWorldAngle = Math.atan2(dx, dz) * 180 / Math.PI;
            // Implementation note.
            const camYaw = this.mainCamera.eulerAngles.y;
            // Implementation note.
            const localAngle = targetWorldAngle - camYaw + 180;
            this.gun.setRotationFromEuler(0, localAngle, 0);
            console.log(`target=${targetWorldAngle.toFixed(1)} camYaw=${camYaw.toFixed(1)} local=${localAngle.toFixed(1)}`);
        }

        if (this._gunCtl) {
            this._gunCtl.onShot = () => this.doFire();
            this._gunCtl.playLaunch();
        } else {
            // Implementation note.
            this.doFire();
        }
    }

    /** Implementation note. */
    private doFire() {
        if (this._state !== GameState.FIRING) return; // Implementation note.
        if (!this._currentShell || !this.gunPoint || !this._markerPlaced) {
            this.setGameState(GameState.RELOAD); // Implementation note.
            return;
        }

        // Implementation note.
        const gunPos = this.gunPoint.worldPosition;

        // Implementation note.
        if (this._currentShell.parent !== this.node) {
            this._currentShell.setParent(this.node);
        }
        this._currentShell.setWorldPosition(gunPos);

        const rigid = this._currentShell.getComponent(RigidBody);
        if (!rigid) {
            this.setGameState(GameState.RELOAD);
            return;
        }

        // Implementation note.
        this.enableShellPhysics();

        // Implementation note.
        // Implementation note.
        // Implementation note.
        rigid.useCCD = true;

        // Implementation note.
        rigid.linearDamping = 0;
        rigid.angularDamping = 0;

        // Implementation note.
        Vec3.subtract(this._tempDir, this._markerWorldPos, gunPos);
        if (this._tempDir.lengthSqr() < 0.0001) {
            this.setGameState(GameState.RELOAD); // Implementation note.
            return;
        }
        this._tempDir.normalize();

        rigid.setLinearVelocity(Vec3.multiplyScalar(this._tempVel, this._tempDir, this.firePower));
        rigid.setAngularVelocity(Vec3.ZERO);

        // Implementation note.
        this.ballRemaining--;
        console.log(`[GameLogic] Balls remaining: ${this.ballRemaining}`);

        // Implementation note.
        this.collectWorldObjs();
        this.setGameState(GameState.RELOAD);
    }

    /** Implementation note. */
    private enterReady() {
        if (this.ballRemaining <= 0) {
            // Implementation note.
            this.showLose();
            this.setGameState(GameState.GAME_OVER);
            return;
        }
        // Implementation note.
        this._currentShell = this.instantiateShell();
        if (!this._currentShell) {
            console.warn('GameLogic: Failed to instantiate shellPrefab');
            this.showLose();
            this.setGameState(GameState.GAME_OVER);
            return;
        }
        this.setGameState(GameState.READY);
        this.attachShellToPoint();
    }

    /** Implementation note. */
    private instantiateShell(): Node | null {
        if (!this.shellPrefab) return null;
        const shell = instantiate(this.shellPrefab);
        shell.parent = this.node;  // Implementation note.

        // Implementation note.
        const col = shell.getComponent(Collider);
        if (col) {
            col.on('onCollisionEnter', this.onShellCollision, this);
        }

        return shell;
    }

    /** Implementation note. */
    private disableShellPhysics() {
        if (!this._currentShell) return;
        // Implementation note.
        const collider = this._currentShell.getComponent(Collider);
        if (collider) collider.enabled = false;
        const rigid = this._currentShell.getComponent(RigidBody);
        if (rigid) rigid.enabled = false;
    }

    /** Implementation note. */
    private enableShellPhysics() {
        if (!this._currentShell) return;
        const rigid = this._currentShell.getComponent(RigidBody);
        if (rigid) rigid.enabled = true;
        const collider = this._currentShell.getComponent(Collider);
        if (collider) collider.enabled = true;
    }

    /** Implementation note. */
    private onShellCollision(_e: ICollisionEvent) {
        const rigid = this._currentShell ? this._currentShell.getComponent(RigidBody) : null;
        if (rigid && !rigid.useGravity) {
            rigid.useGravity = true;
        }
    }

    /** Implementation note. */
    private attachShellToPoint() {
        if (!this._currentShell || !this.gunPoint) return;
        if (this._currentShell.parent !== this.gunPoint) {
            this._currentShell.setParent(this.gunPoint);
        }
        this._currentShell.setPosition(Vec3.ZERO);
        this._currentShell.setRotationFromEuler(0, 0, 0);
        this._currentShell.setScale(Vec3.ONE);

        // Implementation note.
        this.disableShellPhysics();
    }

    /** Resolve the round after the reload delay. */
    private settle() {
        this.collectWorldObjs();
        // Implementation note.
        this.destroyCurrentShell();
        if (this.countWorldObjs() === 0) {
            this.showWin();
            this.setGameState(GameState.GAME_OVER);
        } else if (this.ballRemaining <= 0) {
            // Implementation note.
            this.showLose();
            this.setGameState(GameState.GAME_OVER);
        } else {
            this.enterReady();
        }
    }

    /** Implementation note. */
    private countWorldObjs(): number {
        let count = 0;
        for (const n of this._worldObjs) {
            if (n.isValid && n.active && (n.layer & this._worldLayer) !== 0) count++;
        }
        return count;
    }

    /** Implementation note. */
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

    /** Implementation note. */
    private collectWorldObjs() {
        this._worldObjs = this.node.children.filter(n => (n.layer & this._worldLayer) !== 0);
        // Implementation note.
        // Implementation note.
        for (const n of this._worldObjs) {
            const rb = n.getComponent(RigidBody);
            if (rb) {
                rb.linearDamping = this.worldObjDamping;
                rb.angularDamping = this.worldObjAngularDamping;
            }
        }
    }

    /** Snap objects in the same column into a stable vertical stack. */
    private snapWorldObjs() {
        if (this._worldObjs.length === 0) return;

        // Implementation note.
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

        // Implementation note.
        for (const g of groups) {
            g.sort((a, b) => a.position.y - b.position.y);
            let stackY = this.groundY;
            for (const n of g) {
                // Implementation note.
                const sy = Math.max(n.scale.y, 0.1);
                const halfH = 0.5 * sy; // Implementation note.
                // Implementation note.
                const wp = n.worldPosition;
                n.setWorldPosition(wp.x, stackY + halfH, wp.z);
                stackY += halfH * 2 + 0.02;
            }
        }
    }

    /** Implementation note. */
    private applyExtraGravity() {
        if (this.worldObjFallGravity === 0) return;
        const f = this._tempForce;
        for (const n of this._worldObjs) {
            if (!n.isValid || !n.active) continue;
            const rb = n.getComponent(RigidBody);
            if (!rb || !rb.isDynamic) continue;
            f.set(0, -this.worldObjFallGravity * rb.mass, 0);  // Implementation note.
            rb.applyForce(f);
        }
    }

    /** Implementation note. */
    private checkOutOfBounds() {
        if (this._worldObjs.length === 0) return;
        for (const n of this._worldObjs) {
            if (!n.isValid) continue;
            if (n.worldPosition.y < this.deleteBelowY) {
                n.destroy(); // Implementation note.
            }
        }
    }

    /** Implementation note. */
    private checkShellOutOfBounds() {
        if (!this._currentShell || !this._currentShell.isValid) return;
        // Implementation note.
        if (this._state !== GameState.FIRING && this._state !== GameState.RELOAD) return;
        const pos = this._currentShell.worldPosition;
        const cx = this.orbitCenter.x;
        const cz = this.orbitCenter.z;
        const dx = pos.x - cx;
        const dz = pos.z - cz;
        const horizDist = Math.sqrt(dx * dx + dz * dz);
        if (horizDist > this.shellMaxDistance || pos.y < this.deleteBelowY) {
            console.log(`[GameLogic] Shell removed out of bounds (horizontal distance ${horizDist.toFixed(1)}, Y ${pos.y.toFixed(1)})`);
            this.destroyCurrentShell();
        }
    }

    /** Implementation note. */
    private destroyCurrentShell() {
        if (!this._currentShell) return;
        const col = this._currentShell.getComponent(Collider);
        if (col) {
            col.off('onCollisionEnter', this.onShellCollision, this);
        }
        this._currentShell.destroy();
        this._currentShell = null;
    }

    /** Implementation note. */
    private setGameState(s: GameState) {
        if (this._state === s) return;
        this._state = s;
        this._restTimer = 0;
        console.log(`[GameLogic] State: ${s}`);
        // Implementation note.
        if (this.buttonRetry) {
            this.buttonRetry.active = s === GameState.GAME_OVER;
        }
    }

    /** Implementation note. */
    private showWin() {
        this.showResult('YOU WIN!', new Color(255, 215, 0, 255)); // Gold
    }

    /** Implementation note. */
    private showLose() {
        this.showResult('GAME OVER', new Color(255, 80, 80, 255)); // Red
    }

    /** Implementation note. */
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

            // Implementation note.
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

    /** Implementation note. */
    private onRetryClicked() {
        const sceneName = director.getScene().name;
        director.loadScene("demo");
    }

    /** Implementation note. */
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

    /** Implementation note. */
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
            // Implementation note.
            this._tempPos.set(
                center.x + Math.sin(rad) * this._radius,
                center.y + this._height,   // Implementation note.
                center.z + Math.cos(rad) * this._radius,
            );
            cam.setWorldPosition(this._tempPos);

            // Implementation note.
            const camYaw = this._camYawInit + (this._yaw - this._yawInit);
            cam.setWorldRotationFromEuler(this._pitch, camYaw, this._roll);

            // Implementation note.
            if (this._markerPlaced && this.marker) {
                this.marker.setWorldPosition(this._markerWorldPos);
            }
        }

        // Implementation note.
        this.applyExtraGravity();

        // Implementation note.
        this.checkOutOfBounds();

        // Implementation note.
        this.checkShellOutOfBounds();

        // Implementation note.
        switch (this._state) {
            case GameState.INITIALIZING:
                // Implementation note.
                if (this.allWorldObjsRest()) {
                    this._restTimer += dt;
                    if (this._restTimer >= this.restDelay) this.enterReady();
                } else {
                    this._restTimer = 0;
                }
                break;

            case GameState.RELOAD:
                // Implementation note.
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
