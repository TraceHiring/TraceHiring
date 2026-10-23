// Placeholder from A5-0 (R5-54): the route, its role gate and its nav entry are wired in routes.tsx and shell/nav.ts.
// Stream A5b replaces this file's contents and keeps the export names. Routes `bank/items/new` and
// `bank/items/:itemId` both render it (create, edit and detail).
import ui from '../common/Ui.module.css';

export function ItemRoute() {
  return (
    <section className={ui.stack}>
      <h2 className={ui.title}>Item</h2>
    </section>
  );
}

export default ItemRoute;
