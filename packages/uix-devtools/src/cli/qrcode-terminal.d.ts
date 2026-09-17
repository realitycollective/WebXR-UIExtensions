declare module 'qrcode-terminal' {
  interface QRCodeOptions {
    small?: boolean;
  }
  function generate(
    text: string,
    options?: QRCodeOptions,
    callback?: (code: string) => void,
  ): void;
  function setErrorLevel(level: 'L' | 'M' | 'Q' | 'H'): void;
  export default { generate, setErrorLevel };
}
