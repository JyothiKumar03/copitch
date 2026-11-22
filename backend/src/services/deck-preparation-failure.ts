import type { TDeckPreparationFailure } from "../../../shared/presentation";
import { AppError } from "../errors/app-error";
import type { TSlide } from "../types/deck";

export class DeckPreparationError extends AppError {
  constructor(readonly reason_code: TDeckPreparationFailure["reason_code"], message: string, readonly gaps: string[] = [],
    readonly verified_slides: TSlide[] = [], status = 422) {
    super(status, message);
    this.name = "DeckPreparationError";
  }
}
