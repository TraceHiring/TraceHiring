// Placeholder from A5-0 (R5-54): the route, its role gate and its nav entry are wired in routes.tsx and shell/nav.ts.
// Stream A5c replaces this file's contents and keeps the export names.
import ui from '../common/Ui.module.css';

export function MembersRoute() {
  return (
    <section className={ui.stack}>
      <h2 className={ui.title}>Members</h2>
    </section>
  );
}

export default MembersRoute;
