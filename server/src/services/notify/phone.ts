/**
 * Phone numbers as E.164 for comparing and sending. A bare national number
 * takes PLATFORM_PHONE_DEFAULT_COUNTRY_CODE (digits, default "1"); anything
 * that is not a number is null.
 */
export function defaultCountryCode(env: Record<string, string | undefined> = process.env): string {
  const raw = env.PLATFORM_PHONE_DEFAULT_COUNTRY_CODE?.replace(/\D/g, "");
  return raw && raw.length > 0 ? raw : "1";
}

export function normalizePhone(value: unknown, env: Record<string, string | undefined> = process.env): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return null;
  if (trimmed.startsWith("+")) return `+${digits}`;
  const country = defaultCountryCode(env);
  if (digits.length === 10 && country === "1") return `+1${digits}`;
  if (digits.length === 11 && country === "1" && digits.startsWith("1")) return `+${digits}`;
  if (digits.length > 10) return `+${digits}`;
  return `+${country}${digits}`;
}
