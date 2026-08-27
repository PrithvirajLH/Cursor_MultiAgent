const TEMPLATE_VAR_PATTERN = /\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g;

/**
 * Replace `{{key}}` placeholders with values from `vars`. Unknown keys become
 * empty strings so a typo never leaks the raw placeholder into an email. Seed
 * of the macro variables planned for card 1.7.
 */
export function fillTemplateVars(
  text: string,
  vars: Record<string, string>,
): string {
  return text.replace(
    TEMPLATE_VAR_PATTERN,
    (_match: string, key: string): string => vars[key] ?? '',
  );
}
