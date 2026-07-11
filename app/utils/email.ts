import {uploadMetadataSchema} from "#shared/utils/schemas";

export const validateEmailAddress = (email: string): string | null => {
    const parsed = uploadMetadataSchema.shape.email.safeParse(email.trim());

    return parsed.success ? null : "Enter a valid email address.";
};

export const maskEmailAddress = (email: string): string => {
    const trimmed = email.trim();
    const [local = "", domain = ""] = trimmed.split("@");

    if (!local || !domain) {
        return "your email address";
    }

    const visibleLocal = local.length <= 2 ? local[0] || "" : local.slice(0, 2);
    const domainParts = domain.split(".");
    const firstDomainPart = domainParts[0] || "";
    const visibleDomain = firstDomainPart.slice(0, 1);
    const suffix = domainParts.length > 1 ? `.${domainParts.at(-1)}` : "";

    return `${visibleLocal}${"*".repeat(Math.max(2, local.length - visibleLocal.length))}@${visibleDomain}${"*".repeat(3)}${suffix}`;
};
