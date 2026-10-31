// The M2 drive screens (specs/m2-scheduling-invites.md §6.1, §6.2). Lead stubs (Wave 1): routes.tsx mounts these
// four exports behind the staff gate; stream B5 builds the screens in apps/recruiter/src/drives/** and keeps the
// export names.

export function DrivesRoute() {
  return <h1>Drives</h1>;
}

export function NewDriveRoute() {
  return <h1>New drive</h1>;
}

export function DriveRoute() {
  return <h1>Drive</h1>;
}

export function DriveUploadRoute() {
  return <h1>Invite candidates</h1>;
}
