export const getPrettyPrintNow = () =>
    new Date().toLocaleString("de-DE", {
        dateStyle: "medium",
        timeStyle: "short"
    });
