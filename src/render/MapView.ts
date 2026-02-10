import { Application, Graphics } from 'pixi.js';
import { Viewport } from 'pixi-viewport';
import { World } from '../core/World';

export class MapView {
    app: Application;
    viewport!: Viewport;
    world: World;

    // ПАЛИТРА: Более "землистая" и реалистичная
    private readonly COLORS = {
        OCEAN: 0x364e5e, 
        COAST: 0x486070,

        SAND: 0xd4ccb0,
        GRASS: 0x8fa35d, 
        LAND: 0x6e8c4f,  
        FOREST: 0x4a6b3c, 
        
        DESERT: 0xd1bd8a,
        SWAMP: 0x5a634e,
        
        MOUNTAIN_LOW: 0x7a746d,
        MOUNTAIN_HIGH: 0x5e5b58,
        SNOW: 0xf5f5f5,

        RIVER: 0x4f7082, 
    };

    constructor(element: HTMLElement, world: World) {
        this.world = world;
        this.app = new Application();
        this.init(element);
    }

    async init(element: HTMLElement) {
        await this.app.init({
            background: this.COLORS.OCEAN, 
            resizeTo: window,
            antialias: true,
            resolution: window.devicePixelRatio || 1,
        });
        element.appendChild(this.app.canvas);

        this.viewport = new Viewport({
            // @ts-ignore
            events: this.app.renderer.events,
            screenWidth: window.innerWidth,
            screenHeight: window.innerHeight,
            worldWidth: this.world.width,
            worldHeight: this.world.height,
        });

        this.app.stage.addChild(this.viewport);

        this.viewport
            .drag()
            .pinch()
            .wheel()
            .decelerate()
            .clamp({ direction: 'all', underflow: 'center' })
            .clampZoom({ minScale: 1, maxScale: 40 }); 

        this.viewport.moveCenter(this.world.width / 2, this.world.height / 2);
        this.viewport.setZoom(1);

        this.draw();
        
        window.addEventListener('resize', () => {
            this.viewport.resize(window.innerWidth, window.innerHeight);
        });
    }

    getBiomeColor(height: number, moisture: number): number {
        if (height < 0.0) return this.COLORS.OCEAN;
        if (height < 0.05) return this.COLORS.COAST;

        if (height > 0.8) return this.COLORS.SNOW;
        if (height > 0.6) return this.COLORS.MOUNTAIN_HIGH;
        if (height > 0.45) {
            if (moisture < 0.1) return this.COLORS.MOUNTAIN_LOW; 
            return this.COLORS.FOREST; 
        }

        if (height < 0.12) return this.COLORS.SAND;

        if (moisture < -0.15) return this.COLORS.DESERT;
        if (moisture < 0.15) return this.COLORS.GRASS;
        if (moisture < 0.6) return this.COLORS.LAND;
        
        return this.COLORS.FOREST;
    }

    // Хелпер для затемнения/осветления цвета
    // percent: -0.5 (темнее) до 0.5 (светлее)
    adjustColor(color: number, percent: number): number {
        let r = (color >> 16) & 0xFF;
        let g = (color >> 8) & 0xFF;
        let b = color & 0xFF;

        r = Math.min(255, Math.max(0, r + r * percent));
        g = Math.min(255, Math.max(0, g + g * percent));
        b = Math.min(255, Math.max(0, b + b * percent));

        return (r << 16) | (g << 8) | b;
    }

    draw() {
        const graphics = new Graphics();
        
        // 1. Фон
        graphics.rect(0, 0, this.world.width, this.world.height);
        graphics.fill(this.COLORS.OCEAN);

        // 2. Ландшафт с HILLSHADING (светотень)
        for (let i = 0; i < this.world.cellCount; i++) {
            const h = this.world.elevations[i];
            const m = this.world.moisture[i];
            const baseColor = this.getBiomeColor(h, m);

            if (baseColor === this.COLORS.OCEAN) continue;

            const polygon = this.world.getPolygon(i);
            if (!polygon) continue;

            // Расчет освещения
            const neighbors = this.world.voronoi.neighbors(i);
            let neighborH = h;
            for(const n of neighbors) {
                neighborH = this.world.elevations[n];
                break;
            }

            const shadow = (h - neighborH) * 4.0;
            const noise = (Math.random() - 0.5) * 0.05; 

            const finalColor = this.adjustColor(baseColor, shadow + noise);

            graphics.poly(polygon.flat());
            graphics.fill({ color: finalColor });
        }

        // 3. Реки
        const rivers = this.world.rivers;
        for (let i = 0; i < rivers.length; i += 5) {
            const x1 = rivers[i];
            const y1 = rivers[i+1];
            const x2 = rivers[i+2];
            const y2 = rivers[i+3];
            const flux = rivers[i+4];

            // Реки рисуем тонкими и аккуратными
            const width = Math.min(6, 1.5 + Math.sqrt(flux) * 0.1);

            graphics.moveTo(x1, y1);
            graphics.lineTo(x2, y2);
            graphics.stroke({ width: width, color: this.COLORS.RIVER, alpha: 0.85, cap: 'round', join: 'round' });
        }
        
        this.viewport.addChild(graphics);
    }
}