import './style.css';
import { World } from './core/World';
import { MapView } from './render/MapView';

async function start() {
    const width = window.innerWidth;
    const height = window.innerHeight;

    // ИСПРАВЛЕНИЕ ЗДЕСЬ:
    // Было 1500 (мало точек, огромные клетки).
    // Ставим 50 (много точек, мелкие детали).
    // Для 1920x1080 это даст примерно 40 000 ячеек.
    const pointDensity = 50; 
    
    const numPoints = Math.floor((width * height) / pointDensity);

    console.log(`Generating world: ${width}x${height} with ${numPoints} cells`);

    console.time('World Gen');
    const world = new World(width, height, numPoints);
    console.timeEnd('World Gen');

    const appDiv = document.getElementById('app');
    if (appDiv) {
        appDiv.innerHTML = '';
        new MapView(appDiv, world);
    }
}

start();