// Placeholder from A5-0 (R5-54). It has no route of its own (R5-15, spec 6.1): stream A5c turns it into the
// component for template choice inside step 1 of tests/new and keeps the export names.
import ui from '../common/Ui.module.css';

export function FromTemplateRoute() {
  return (
    <section className={ui.stack}>
      <h2 className={ui.title}>New test from a template</h2>
    </section>
  );
}

export default FromTemplateRoute;
