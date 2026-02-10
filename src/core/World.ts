import { Delaunay } from 'd3-delaunay';
import { createNoise2D } from 'simplex-noise';
import PoissonDiskSampling from 'poisson-disk-sampling';
import { MinHeap } from './Utils';

export class World {
    width: number;
    height: number;
    
    points: Float64Array;
    voronoi: any;
    
    // КЭШ СОСЕДЕЙ (Оптимизация)
    // Массив массивов индексов соседей для каждой клетки
    adjacency: Int32Array[]; 

    elevations: Float32Array;
    moisture: Float32Array;
    rivers: Float32Array; 

    private noise2D = createNoise2D();
    
    private offsetElevationX = Math.random() * 10000;
    private offsetElevationY = Math.random() * 10000;
    private offsetMoistureX = Math.random() * 10000;
    private offsetMoistureY = Math.random() * 10000;

    constructor(width: number, height: number, numPoints: number) {
        this.width = width;
        this.height = height;
        
        console.time('Points Generation');
        // 1. Быстрая генерация равномерных точек (вместо Relaxations)
        this.points = this.generatePoissonPoints(numPoints);
        console.timeEnd('Points Generation');

        console.time('Voronoi');
        // 2. Построение сетки (Один раз!)
        this.calculateVoronoi();
        console.timeEnd('Voronoi');

        console.time('Adjacency Precalc');
        // 3. Предварительный расчет соседей (чтобы не считать их в циклах)
        this.adjacency = this.precalculateNeighbors();
        console.timeEnd('Adjacency Precalc');

        this.elevations = new Float32Array(this.cellCount);
        this.moisture = new Float32Array(this.cellCount);
        
        console.time('Terrain Gen');
        this.generateTerrain();
        console.timeEnd('Terrain Gen');
        
        console.time('Smoothing');
        this.smoothMap(this.elevations, 2);
        this.smoothMap(this.moisture, 2);
        console.timeEnd('Smoothing');

        console.time('Fill Sinks');
        this.fillSinks(); // Оптимизированная версия
        console.timeEnd('Fill Sinks');

        console.time('Rivers');
        this.rivers = this.generateRivers();
        console.timeEnd('Rivers');
    }

    // Poisson Disk Sampling: Генерирует точки, которые не стоят слишком близко друг к другу.
    // Это заменяет Релаксацию Ллойда и работает быстрее.
    private generatePoissonPoints(targetNumPoints: number): Float64Array {
        // Примерная плотность, чтобы получить нужное количество точек
        // minDistance ~ sqrt(Area / N) * 0.8
        const area = this.width * this.height;
        const minDistance = Math.sqrt(area / targetNumPoints) * 0.85;

        const pds = new PoissonDiskSampling({
            shape: [this.width, this.height],
            minDistance: minDistance,
            tries: 10 // Низкое значение для скорости, качество все равно хорошее
        });

        const pointsArray = pds.fill();
        const points = new Float64Array(pointsArray.length * 2);
        
        for (let i = 0; i < pointsArray.length; i++) {
            points[i * 2] = pointsArray[i][0];
            points[i * 2 + 1] = pointsArray[i][1];
        }
        
        return points;
    }

    private calculateVoronoi() {
        const delaunay = new Delaunay(this.points);
        this.voronoi = delaunay.voronoi([0, 0, this.width, this.height]);
    }

    // Сохраняем соседей в массив, чтобы d3-delaunay не пересчитывал их каждый раз
    private precalculateNeighbors(): Int32Array[] {
        const adj = new Array(this.cellCount);
        for (let i = 0; i < this.cellCount; i++) {
            const neighborsGenerator = this.voronoi.neighbors(i);
            adj[i] = Int32Array.from(neighborsGenerator);
        }
        return adj;
    }

    private fbm(x: number, y: number, octaves: number, scale: number, offsetX: number, offsetY: number): number {
        let value = 0;
        let amplitude = 0.5;
        let frequency = 1;
        for (let i = 0; i < octaves; i++) {
            const nx = (x + offsetX) / scale * frequency;
            const ny = (y + offsetY) / scale * frequency;
            value += this.noise2D(nx, ny) * amplitude;
            frequency *= 2;
            amplitude *= 0.5;
        }
        return value;
    }

    private smoothMap(data: Float32Array, iterations: number) {
        let current = data;
        // TS может ругаться здесь, поэтому кастуем
        let next = new Float32Array(data.length) as any as Float32Array;

        for (let k = 0; k < iterations; k++) {
            for (let i = 0; i < this.cellCount; i++) {
                let sum = current[i];
                let count = 1;
                
                const neighbors = this.adjacency[i];
                for (let j = 0; j < neighbors.length; j++) {
                    sum += current[neighbors[j]];
                    count++;
                }
                next[i] = sum / count;
            }
            let temp = current;
            current = next;
            next = temp;
        }

        if (current !== data) {
            // И здесь, если ругается на несовместимость
            (data as any).set(current);
        }
    }

    // === ОПТИМИЗИРОВАННОЕ ЗАПОЛНЕНИЕ ВПАДИН (Priority Queue) ===
    // O(N log N) вместо O(N^2)
    private fillSinks() {
        const epsilon = 1e-5;
        
        // Очередь с приоритетом (хранит индекс клетки, сортирует по высоте)
        // Сначала обрабатываем самые низкие клетки
        const heap = new MinHeap<number>((a, b) => this.elevations[a] - this.elevations[b]);
        const visited = new Uint8Array(this.cellCount); // 0 - false, 1 - true

        // 1. Добавляем все граничные клетки (Океан/Край карты) в очередь
        for (let i = 0; i < this.cellCount; i++) {
            // Если высота <= 0 (Океан), это начальная точка стока
            if (this.elevations[i] <= 0) {
                heap.push(i);
                visited[i] = 1;
            }
        }

        // 2. Жадный алгоритм
        while (heap.length > 0) {
            const u = heap.pop()!;
            
            const neighbors = this.adjacency[u];
            for (let j = 0; j < neighbors.length; j++) {
                const v = neighbors[j];
                
                if (visited[v] === 1) continue;

                // Если сосед (v) ниже текущей клетки (u), значит v - это яма.
                // Поднимаем v до уровня u + чуть-чуть.
                // Так как мы идем от океана вверх, мы "цементируем" ямы снизу вверх.
                if (this.elevations[v] < this.elevations[u]) {
                    this.elevations[v] = this.elevations[u] + epsilon;
                }

                visited[v] = 1;
                heap.push(v);
            }
        }
    }

    private generateTerrain() {
        const minSide = Math.min(this.width, this.height);
        const scaleElevation = minSide * (0.5 + Math.random() * 0.5); 
        const scaleMoisture = minSide * (0.5 + Math.random() * 0.5);

        for (let i = 0; i < this.cellCount; i++) {
            const x = this.points[i * 2];
            const y = this.points[i * 2 + 1];

            // Высота
            let h = this.fbm(x, y, 5, scaleElevation, this.offsetElevationX, this.offsetElevationY);
            h += Math.abs(this.fbm(x, y, 4, scaleElevation / 4, this.offsetElevationX + 5000, this.offsetElevationY)) * 0.3;
            this.elevations[i] = h - 0.15; 

            // Влажность
            let m = this.fbm(x, y, 4, scaleMoisture, this.offsetMoistureX, this.offsetMoistureY);
            if (this.elevations[i] < 0) m += 0.5;
            this.moisture[i] = m;
        }
    }

    private calculateDistanceToCoast(): Int32Array {
        const distance = new Int32Array(this.cellCount).fill(-1);
        const queue: number[] = []; // Простой массив как очередь (FIFO)
        let queueStart = 0; // Указатель начала очереди для оптимизации shift()

        for (let i = 0; i < this.cellCount; i++) {
            if (this.elevations[i] <= 0) {
                distance[i] = 0;
                queue.push(i);
            }
        }

        while (queueStart < queue.length) {
            const current = queue[queueStart++];
            const currentDist = distance[current];
            const neighbors = this.adjacency[current];

            for (let j = 0; j < neighbors.length; j++) {
                const nId = neighbors[j];
                if (distance[nId] === -1) {
                    distance[nId] = currentDist + 1;
                    queue.push(nId);
                }
            }
        }
        return distance;
    }

    private generateRivers(): Float32Array {
        const downhill = new Int32Array(this.cellCount).fill(-1);
        const distToCoast = this.calculateDistanceToCoast();
        
        // 1. Направление стока
        for (let i = 0; i < this.cellCount; i++) {
            if (this.elevations[i] <= 0.05) continue;

            let bestNeighbor = -1;
            let lowestH = this.elevations[i];
            let bestDist = distToCoast[i];

            const neighbors = this.adjacency[i];
            for (let j = 0; j < neighbors.length; j++) {
                const nId = neighbors[j];
                const nH = this.elevations[nId];
                const nDist = distToCoast[nId];

                if (nH < lowestH) {
                    lowestH = nH;
                    bestDist = nDist; 
                    bestNeighbor = nId;
                } else if (nH === lowestH && nDist < bestDist) {
                    bestDist = nDist;
                    bestNeighbor = nId;
                }
            }
            downhill[i] = bestNeighbor;
        }

        // 2. Flux
        const flux = new Float32Array(this.cellCount).fill(1.0);
        
        // Быстрая сортировка индексов
        const sortedIndices = new Int32Array(this.cellCount);
        for(let i=0; i<this.cellCount; i++) sortedIndices[i] = i;
        
        sortedIndices.sort((a, b) => {
            if (this.elevations[b] !== this.elevations[a]) {
                return this.elevations[b] - this.elevations[a];
            }
            return distToCoast[b] - distToCoast[a];
        });

        for (let j = 0; j < this.cellCount; j++) {
            const i = sortedIndices[j];
            const target = downhill[i];
            if (target >= 0 && this.elevations[i] > 0) {
                flux[target] += flux[i];
            }
        }

        // 3. Сборка рек
        const riverSegments: number[] = [];
        const RIVER_THRESHOLD = 50; 

        for (let i = 0; i < this.cellCount; i++) {
            if (flux[i] > RIVER_THRESHOLD && this.elevations[i] > 0) {
                const target = downhill[i];
                if (target >= 0) {
                    const x1 = this.points[i * 2];
                    const y1 = this.points[i * 2 + 1];
                    const x2 = this.points[target * 2];
                    const y2 = this.points[target * 2 + 1];
                    riverSegments.push(x1, y1, x2, y2, flux[i]);
                }
            }
        }

        return new Float32Array(riverSegments);
    }

    getPolygon(i: number): number[][] {
        return Array.from(this.voronoi.cellPolygon(i)) as number[][];
    }
    
    get cellCount(): number {
        return this.points.length / 2;
    }
}