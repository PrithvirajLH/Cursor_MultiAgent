import { ArrayMaxSize, IsArray, IsString, MaxLength } from 'class-validator';

/**
 * The full set of built-in presets a team has switched off (card 1.53).
 *
 * A whole-list replace rather than add/remove, because the UI is a column of
 * checkboxes: sending the resulting set is one round trip and cannot drift from
 * what the admin is looking at.
 *
 * ⚠️ The ids are CODE CONSTANTS from the web app's `SAVED_VIEWS`, not rows, so
 * there is nothing to validate them against here and nothing to cascade. An id
 * whose preset is later renamed or deleted is ignored silently by the reader.
 * The cap is a sanity bound, not a business rule - there are ten presets today.
 */
export class SetHiddenPresetsDto {
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  presetIds!: string[];
}
