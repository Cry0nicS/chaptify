export const formatExpiration = (expiresAt: string | null | undefined): string | null => {
    if (!expiresAt) {
        return null;
    }

    const date = new Date(expiresAt);

    if (Number.isNaN(date.getTime())) {
        return null;
    }

    return new Intl.DateTimeFormat(undefined, {
        dateStyle: "full",
        timeStyle: "short"
    }).format(date);
};
