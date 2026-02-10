export class MinHeap<T> {
    private heap: T[] = [];
    private compare: (a: T, b: T) => number;

    constructor(compare: (a: T, b: T) => number) {
        this.compare = compare;
    }

    push(item: T) {
        this.heap.push(item);
        this.bubbleUp(this.heap.length - 1);
    }

    pop(): T | undefined {
        if (this.heap.length === 0) return undefined;
        const top = this.heap[0];
        const bottom = this.heap.pop();
        if (this.heap.length > 0 && bottom !== undefined) {
            this.heap[0] = bottom;
            this.bubbleDown(0);
        }
        return top;
    }

    get length() {
        return this.heap.length;
    }

    private bubbleUp(index: number) {
        while (index > 0) {
            const parentIndex = (index - 1) >>> 1;
            if (this.compare(this.heap[index], this.heap[parentIndex]) < 0) {
                this.swap(index, parentIndex);
                index = parentIndex;
            } else {
                break;
            }
        }
    }

    private bubbleDown(index: number) {
        while (true) {
            const leftIndex = (index << 1) + 1;
            const rightIndex = leftIndex + 1;
            let swapIndex = -1;

            if (leftIndex < this.heap.length) {
                if (rightIndex < this.heap.length) {
                    swapIndex = this.compare(this.heap[leftIndex], this.heap[rightIndex]) < 0 ? leftIndex : rightIndex;
                } else {
                    swapIndex = leftIndex;
                }
            } else {
                break;
            }

            if (this.compare(this.heap[swapIndex], this.heap[index]) < 0) {
                this.swap(index, swapIndex);
                index = swapIndex;
            } else {
                break;
            }
        }
    }

    private swap(i: number, j: number) {
        const temp = this.heap[i];
        this.heap[i] = this.heap[j];
        this.heap[j] = temp;
    }
}