/**
 * Hoi dap tren console cho RUN.bat che do tuong tac va cho manual pause/resume.
 */
import readline from 'node:readline';

export function isInteractive() {
  return Boolean(process.stdin.isTTY);
}

/** Hoi mot cau va tra ve chuoi da trim. */
export function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(String(answer ?? '').trim());
    });
  });
}

/**
 * Dung chay cho nguoi dung xu ly tay (login/CAPTCHA) roi nhan Enter.
 * @param {string} message
 * @param {number} timeoutMs
 * @returns {Promise<boolean>} true neu nguoi dung nhan Enter, false neu het gio
 */
export function waitForEnter(message, timeoutMs = 600000) {
  if (!isInteractive()) return Promise.resolve(false);
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const timer = setTimeout(() => {
      rl.close();
      resolve(false);
    }, timeoutMs);
    rl.question(`${message}\n> `, () => {
      clearTimeout(timer);
      rl.close();
      resolve(true);
    });
  });
}
