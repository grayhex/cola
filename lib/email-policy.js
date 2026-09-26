// One capability boundary, independent of SMTP availability and user role.
export const EMAIL_VERIFICATION_REQUIRED = "EMAIL_VERIFICATION_REQUIRED";
export const EMAIL_POLICY_MESSAGE = "Подтвердите почту, чтобы публиковать, обсуждать и получать контакты продавцов. Черновик можно сохранить.";
export class EmailPolicyError extends Error {
  constructor() {
    super(EMAIL_POLICY_MESSAGE);
    this.code = EMAIL_VERIFICATION_REQUIRED;
    this.status = 403;
  }
}
/** @param {{ email_verified_at?: Date | string | null }} user */
export function requireVerifiedEmail(user) {
  if (!user.email_verified_at) throw new EmailPolicyError();
}
