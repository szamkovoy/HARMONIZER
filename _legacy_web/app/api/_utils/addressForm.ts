export type AddressForm = "formal" | "informal";

export function buildAddressFormHint(addressForm: string | null | undefined, language: string | null | undefined): string {
  const normalizedLanguage = language?.trim().toLowerCase() ?? "";
  if (normalizedLanguage.startsWith("ru") || normalizedLanguage === "") {
    return addressForm === "informal" ? "ты" : "вы";
  }
  return "you";
}
