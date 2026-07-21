export class IntakeError extends Error {
  constructor(message) {
    super(message);
    this.name = "IntakeError";
  }
}
