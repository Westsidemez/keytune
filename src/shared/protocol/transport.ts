// Serialised request/response channel over a 32-byte raw HID link.
//
// QMK answers every raw HID report by echoing the buffer back with values
// filled in, so a response is matched by its leading command byte(s). Keychron
// firmware also pushes unsolicited reports (layer changes, factory reset), which
// are routed to listeners instead of being mistaken for a reply.

export const REPORT_SIZE = 32;

/** Command byte firmware writes when it does not understand a request. */
export const UNHANDLED = 0xff;

export interface HidLink {
  send(report: Uint8Array): Promise<void>;
  /** Subscribe to input reports. Returns an unsubscribe function. */
  onReport(listener: (report: Uint8Array) => void): () => void;
}

export class ProtocolError extends Error {
  constructor(
    message: string,
    readonly request?: Uint8Array,
  ) {
    super(message);
    this.name = "ProtocolError";
  }
}

export class UnsupportedCommandError extends ProtocolError {
  constructor(request: Uint8Array) {
    super(`Keyboard does not support command 0x${hex(request[0])}${groupSuffix(request)}`, request);
    this.name = "UnsupportedCommandError";
  }
}

export class TimeoutError extends ProtocolError {
  constructor(request: Uint8Array) {
    super(`Keyboard did not answer command 0x${hex(request[0])}${groupSuffix(request)}`, request);
    this.name = "TimeoutError";
  }
}

export interface TransportOptions {
  timeoutMs?: number;
  /** Extra attempts after a timeout. Writes are idempotent, so retrying is safe. */
  retries?: number;
}

/** Keychron command groups whose second byte is a sub-command. */
const GROUPED_COMMANDS = new Set([0xa7, 0xa8, 0xa9]);

export interface RequestOptions {
  /**
   * Number of bytes after the command byte that the firmware echoes unchanged
   * (offsets, layer/row/col). Checking them stops a late reply to a timed-out
   * request from being taken as the answer to the next one.
   */
  echo?: number;
}

interface Pending {
  request: Uint8Array;
  echo: number;
  resolve(report: Uint8Array): void;
}

export class Transport {
  private queue: Promise<unknown> = Promise.resolve();
  private pending: Pending | null = null;
  private readonly listeners = new Set<(report: Uint8Array) => void>();
  private readonly unsubscribe: () => void;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private closed = false;

  constructor(
    private readonly link: HidLink,
    options: TransportOptions = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? 1500;
    this.retries = options.retries ?? 1;
    this.unsubscribe = link.onReport((report) => this.receive(report));
  }

  /** Listen for reports that are not replies to a request. */
  onUnsolicited(listener: (report: Uint8Array) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Send one request and resolve with the keyboard's reply. Requests are
   * queued so exactly one is in flight; replies carry no sequence number.
   */
  request(bytes: ArrayLike<number>, options: RequestOptions = {}): Promise<Uint8Array> {
    const report = new Uint8Array(REPORT_SIZE);
    if (bytes.length > REPORT_SIZE) throw new ProtocolError(`Request is ${bytes.length} bytes; the limit is ${REPORT_SIZE}`);
    report.set(Array.from(bytes));
    const echo = Math.min(options.echo ?? 0, bytes.length - 1);
    const run = () => this.exchange(report, echo);
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }

  close(): void {
    this.closed = true;
    this.unsubscribe();
    this.listeners.clear();
  }

  private async exchange(report: Uint8Array, echo: number): Promise<Uint8Array> {
    for (let attempt = 0; ; attempt++) {
      if (this.closed) throw new ProtocolError("Keyboard disconnected", report);
      try {
        const reply = await this.once(report, echo);
        if (reply[0] === UNHANDLED) throw new UnsupportedCommandError(report);
        return reply;
      } catch (error) {
        if (!(error instanceof TimeoutError) || attempt >= this.retries) throw error;
      }
    }
  }

  private once(report: Uint8Array, echo: number): Promise<Uint8Array> {
    return new Promise<Uint8Array>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending?.request === report) this.pending = null;
        reject(new TimeoutError(report));
      }, this.timeoutMs);
      this.pending = {
        request: report,
        echo,
        resolve: (reply) => {
          clearTimeout(timer);
          resolve(reply);
        },
      };
      this.link.send(report).catch((error: unknown) => {
        clearTimeout(timer);
        if (this.pending?.request === report) this.pending = null;
        reject(error instanceof Error ? error : new ProtocolError(String(error), report));
      });
    });
  }

  private receive(report: Uint8Array): void {
    const pending = this.pending;
    if (pending && matches(pending, report)) {
      this.pending = null;
      pending.resolve(report);
      return;
    }
    for (const listener of this.listeners) listener(report);
  }
}

function matches({ request, echo }: Pending, reply: Uint8Array): boolean {
  // An unhandled reply has its command byte replaced, so it cannot be matched
  // by content; only one request is ever in flight, so it belongs to it.
  if (reply[0] === UNHANDLED) return true;
  if (reply[0] !== request[0]) return false;
  if (GROUPED_COMMANDS.has(request[0]) && reply[1] !== request[1]) return false;
  for (let i = 1; i <= echo; i++) if (reply[i] !== request[i]) return false;
  return true;
}

function hex(value: number): string {
  return value.toString(16).toUpperCase().padStart(2, "0");
}

function groupSuffix(request: Uint8Array): string {
  return GROUPED_COMMANDS.has(request[0]) ? `/0x${hex(request[1])}` : "";
}
