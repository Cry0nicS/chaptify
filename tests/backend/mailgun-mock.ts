import {vi} from "vitest";

/**
 * Module factory for `vi.mock("mailgun.js", ...)`. Each test file that exercises email paths
 * installs it so no test can reach the real Mailgun client. The created spy is exposed as
 * `__mailgunCreate` on the mocked module for per-test assertions.
 */
export const mailgunModuleMock = () => {
    const create = vi.fn();
    class MailgunMock {
        public client() {
            return {
                messages: {
                    create
                }
            };
        }
    }

    return {
        default: MailgunMock,
        __mailgunCreate: create
    };
};

export const getMailgunCreateMock = async (): Promise<ReturnType<typeof vi.fn>> => {
    const mocked = await import("mailgun.js");

    return Reflect.get(mocked, "__mailgunCreate") as ReturnType<typeof vi.fn>;
};
