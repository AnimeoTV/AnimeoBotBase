
//////////////////////////////////////
//  TYPES
//////////////////////////////////////


declare global {
    interface DateConstructor {
        elapsed(date: number): number;
    }

    interface Math {
        randomBetween(min: number, max: number): number;
    }

    interface Array<T> {
        random(): T;
        shuffle(): this;
    }
}


//////////////////////////////////////
//  DATE
//////////////////////////////////////


Date.elapsed = function (date: number): number {
    return (Date.now() - date);
};


//////////////////////////////////////
//  MATH
//////////////////////////////////////


Math.randomBetween = function (min: number, max: number): number {
    return (min + Math.floor(Math.random() * (max - min)));
};


//////////////////////////////////////
//  ARRAY
//////////////////////////////////////


Array.prototype.random = function <T>(): T {
    return this[Math.floor(Math.random() * this.length)];
};

Array.prototype.shuffle = function <T>(): T[] {
    for (let i = this.length - 1; i > 0; i--) {
        let j = Math.floor(Math.random() * (i + 1));

        // Swap elements.
        [this[i], this[j]] = [this[j], this[i]];
    }

    return this;
};
