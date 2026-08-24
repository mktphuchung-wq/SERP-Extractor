/**
 * May trang thai khai bao dung chung cho orchestrator va AI Mode adapter.
 * Moi state co ham run(ctx) tra ve ten state ke tiep (hoac {to, ...patch}).
 * Muc tieu: workflow doc duoc, test duoc, khong phai mot script dai.
 */
import { AppError } from './errors.mjs';

/**
 * @typedef {{ run:(ctx:object, machine:Machine)=>Promise<string|{to:string,[k:string]:any}>, final?:boolean }} StateDef
 */

export class Machine {
  /**
   * @param {{id:string, initial:string, states:Record<string,StateDef>, context?:object, logger?:object, maxTransitions?:number}} def
   */
  constructor(def) {
    this.id = def.id;
    this.initial = def.initial;
    this.states = def.states;
    this.context = def.context ?? {};
    this.logger = def.logger;
    this.maxTransitions = def.maxTransitions ?? 50;
    this.history = [];

    if (!this.states[this.initial]) {
      throw new AppError('INVALID_CONFIG', `State machine ${this.id}: initial state "${this.initial}" khong ton tai`);
    }
  }

  /** Ghi du lieu vao context giua cac state. */
  patch(data) {
    Object.assign(this.context, data);
    return this.context;
  }

  async run() {
    let current = this.initial;
    for (let i = 0; i < this.maxTransitions; i += 1) {
      const state = this.states[current];
      if (!state) {
        throw new AppError('INVALID_CONFIG', `State machine ${this.id}: state "${current}" khong ton tai`);
      }
      this.history.push(current);
      this.logger?.debug(`[${this.id}] -> ${current}`);

      if (state.final) {
        this.context.finalState = current;
        return this.context;
      }

      const result = await state.run(this.context, this);
      if (result && typeof result === 'object') {
        const { to, ...patch } = result;
        this.patch(patch);
        current = to;
      } else if (typeof result === 'string') {
        current = result;
      } else {
        throw new AppError(
          'INVALID_CONFIG',
          `State machine ${this.id}: state "${current}" khong tra ve state ke tiep`,
        );
      }
    }
    throw new AppError(
      'INVALID_CONFIG',
      `State machine ${this.id}: vuot qua ${this.maxTransitions} lan chuyen trang thai (nghi ngo vong lap)`,
    );
  }
}

export function createMachine(def) {
  return new Machine(def);
}
