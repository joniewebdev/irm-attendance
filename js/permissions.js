export const ROLE_PERMISSIONS = {
    administrator: ["members.read", "members.write", "members.archive", "attendance.read", "attendance.write", "reports.read", "users.manage", "audit.read"],
    attendance_encoder: ["members.read", "members.write", "attendance.read", "attendance.write", "reports.read"],
    viewer: ["members.read", "attendance.read", "reports.read"]
};
export function can(profile, permission) {
    return Boolean(profile && ROLE_PERMISSIONS[profile.role]?.includes(permission))
}