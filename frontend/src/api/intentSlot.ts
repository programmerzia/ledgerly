/**
 * Holds the Idempotency intent of a user action across retries (13 §11, docs/15 rule 7).
 *
 * `for(signature)` returns the same intent while the payload is unchanged, so "Try again" after a network error, a 5xx,
 * a 409 or a signature prompt reuses the key and cannot double-post. If the user changed what is being sent, the
 * signature differs and a new intent is made (the server would refuse the old key with a different body anyway).
 * The client settles the key itself on 2xx/422; call `clear()` after success so the next action starts clean.
 */
import { createIntent, type Intent } from './idempotency';

export class IntentSlot {
  private intent: Intent | null = null;
  private current = '';

  for(signature: string): Intent {
    if (!this.intent || this.current !== signature) {
      this.intent = createIntent();
      this.current = signature;
    }
    return this.intent;
  }

  clear(): void {
    this.intent = null;
    this.current = '';
  }
}
