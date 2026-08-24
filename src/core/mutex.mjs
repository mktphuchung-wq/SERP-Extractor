/**
 * Khoa bat dong bo don gian.
 *
 * Dung de bao ve "vung tranh chap" khi chay song song nhieu tab:
 * cac thao tac phu thuoc TAB DANG ACTIVE (mo popup extension, bringToFront,
 * doc clipboard) khong duoc phep chay chong len nhau, neu khong se lay nham
 * du lieu cua tab khac.
 */
export class Mutex {
  constructor(name = 'mutex') {
    this.name = name;
    this.queue = [];
    this.locked = false;
  }

  acquire() {
    if (!this.locked) {
      this.locked = true;
      return Promise.resolve(() => this.#release());
    }
    return new Promise((resolve) => {
      this.queue.push(() => resolve(() => this.#release()));
    });
  }

  #release() {
    const next = this.queue.shift();
    if (next) next();
    else this.locked = false;
  }

  /** Chay fn trong vung duoc bao ve, luon nha khoa du fn nem loi. */
  async run(fn) {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

/** Khoa gia - dung o che do tuan tu de adapter khong phai phan nhanh. */
export const NO_LOCK = {
  name: 'no-lock',
  async run(fn) { return fn(); },
  async acquire() { return () => {}; },
};
