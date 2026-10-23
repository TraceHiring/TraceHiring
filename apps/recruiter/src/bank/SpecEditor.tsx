// The parameter spec editor (specs/m1-test-authoring.md §6.3, ABH-7). It writes the ParamSpec of the contract as
// text fields and shows every validation problem by its path. The api parses the expressions and generates the
// variants (when the item goes to review); nothing is evaluated or generated here.
import ui from '../common/Ui.module.css';
import {
  MAX_CONSTRAINTS,
  MAX_DERIVED,
  MAX_OPTIONS,
  MAX_PARAMS,
  MIN_OPTIONS,
  addConstraint,
  addDerived,
  addParam,
  addSpecOption,
  errorsUnder,
  removeSpecOption,
  seedSpecFromItem,
  type FieldError,
  type ItemForm,
  type ParamRow,
  type SpecForm,
} from './item-form';

export function SpecEditor({
  form,
  errors,
  onChange,
}: {
  form: ItemForm;
  errors: readonly FieldError[];
  onChange(next: ItemForm): void;
}) {
  const spec = form.spec;
  const setSpec = (patch: Partial<SpecForm>) => {
    onChange({ ...form, spec: { ...spec, ...patch } });
  };
  const setParam = (index: number, patch: Partial<ParamRow>) => {
    setSpec({ params: spec.params.map((p, i) => (i === index ? { ...p, ...patch } : p)) });
  };
  const problems = errorsUnder(errors, 'paramSpec');
  return (
    <section className={ui.stack} aria-label="Parameter spec">
      <p className={ui.note}>
        The server makes the variants when the item goes to review. Write the ranges and the
        templates here; use {'{{name}}'} where a value goes.
      </p>

      <fieldset className={ui.fieldset}>
        <legend>Parameters</legend>
        {spec.params.map((p, i) => {
          const n = String(i + 1);
          return (
            <div key={i} className={ui.row} data-param-row>
              <label className={ui.field}>
                <span className={ui.label}>{`Parameter ${n} name`}</span>
                <input
                  className={ui.input}
                  type="text"
                  value={p.name}
                  onChange={(e) => {
                    setParam(i, { name: e.target.value });
                  }}
                />
              </label>
              <label className={ui.field}>
                <span className={ui.label}>{`Parameter ${n} kind`}</span>
                <select
                  className={ui.select}
                  value={p.kind}
                  onChange={(e) => {
                    setParam(i, { kind: e.target.value === 'choice' ? 'choice' : 'int' });
                  }}
                >
                  <option value="int">Whole number</option>
                  <option value="choice">Choice</option>
                </select>
              </label>
              {p.kind === 'int' ? (
                <>
                  {(['min', 'max', 'step'] as const).map((key) => (
                    <label key={key} className={ui.field}>
                      <span className={ui.label}>
                        {`Parameter ${n} ${key === 'min' ? 'minimum' : key === 'max' ? 'maximum' : 'step'}`}
                      </span>
                      <input
                        className={ui.input}
                        type="text"
                        inputMode="numeric"
                        value={p[key]}
                        onChange={(e) => {
                          setParam(i, { [key]: e.target.value });
                        }}
                      />
                    </label>
                  ))}
                </>
              ) : (
                <label className={ui.field}>
                  <span className={ui.label}>{`Parameter ${n} values`}</span>
                  <input
                    className={ui.input}
                    type="text"
                    placeholder="3, 5, 8"
                    value={p.values}
                    onChange={(e) => {
                      setParam(i, { values: e.target.value });
                    }}
                  />
                </label>
              )}
              <button
                type="button"
                className={ui.button}
                aria-label={`Remove parameter ${n}`}
                disabled={spec.params.length <= 1}
                onClick={() => {
                  setSpec({ params: spec.params.filter((_, at) => at !== i) });
                }}
              >
                Remove
              </button>
            </div>
          );
        })}
        <div>
          <button
            type="button"
            className={ui.button}
            disabled={spec.params.length >= MAX_PARAMS}
            onClick={() => {
              onChange(addParam(form));
            }}
          >
            Add parameter
          </button>
        </div>
      </fieldset>

      <fieldset className={ui.fieldset}>
        <legend>Derived values</legend>
        {spec.derived.map((d, i) => {
          const n = String(i + 1);
          return (
            <div key={i} className={ui.row}>
              <label className={ui.field}>
                <span className={ui.label}>{`Derived ${n} name`}</span>
                <input
                  className={ui.input}
                  type="text"
                  value={d.name}
                  onChange={(e) => {
                    setSpec({
                      derived: spec.derived.map((row, at) =>
                        at === i ? { ...row, name: e.target.value } : row,
                      ),
                    });
                  }}
                />
              </label>
              <label className={ui.field}>
                <span className={ui.label}>{`Derived ${n} expression`}</span>
                <input
                  className={ui.input}
                  type="text"
                  placeholder="a + b"
                  value={d.expr}
                  onChange={(e) => {
                    setSpec({
                      derived: spec.derived.map((row, at) =>
                        at === i ? { ...row, expr: e.target.value } : row,
                      ),
                    });
                  }}
                />
              </label>
              <button
                type="button"
                className={ui.button}
                aria-label={`Remove derived ${n}`}
                onClick={() => {
                  setSpec({ derived: spec.derived.filter((_, at) => at !== i) });
                }}
              >
                Remove
              </button>
            </div>
          );
        })}
        <div>
          <button
            type="button"
            className={ui.button}
            disabled={spec.derived.length >= MAX_DERIVED}
            onClick={() => {
              onChange(addDerived(form));
            }}
          >
            Add derived value
          </button>
        </div>
      </fieldset>

      <fieldset className={ui.fieldset}>
        <legend>Constraints</legend>
        {spec.constraints.map((expr, i) => {
          const n = String(i + 1);
          return (
            <div key={i} className={ui.row}>
              <label className={ui.field}>
                <span className={ui.label}>{`Constraint ${n}`}</span>
                <input
                  className={ui.input}
                  type="text"
                  placeholder="a < b"
                  value={expr}
                  onChange={(e) => {
                    setSpec({
                      constraints: spec.constraints.map((c, at) => (at === i ? e.target.value : c)),
                    });
                  }}
                />
              </label>
              <button
                type="button"
                className={ui.button}
                aria-label={`Remove constraint ${n}`}
                onClick={() => {
                  setSpec({ constraints: spec.constraints.filter((_, at) => at !== i) });
                }}
              >
                Remove
              </button>
            </div>
          );
        })}
        <div>
          <button
            type="button"
            className={ui.button}
            disabled={spec.constraints.length >= MAX_CONSTRAINTS}
            onClick={() => {
              onChange(addConstraint(form));
            }}
          >
            Add constraint
          </button>
        </div>
      </fieldset>

      <fieldset className={ui.fieldset}>
        <legend>Templates</legend>
        <div>
          <button
            type="button"
            className={ui.button}
            onClick={() => {
              onChange(seedSpecFromItem(form));
            }}
          >
            Copy the question and options into the spec
          </button>
        </div>
        <label className={ui.field}>
          <span className={ui.label}>Question template</span>
          <textarea
            className={ui.textarea}
            value={spec.stem}
            onChange={(e) => {
              setSpec({ stem: e.target.value });
            }}
          />
        </label>
        {spec.options.map((o, i) => {
          const n = String(i + 1);
          return (
            <div key={o.id} className={ui.row}>
              <label className={ui.choice}>
                <input
                  type="radio"
                  name="spec-key"
                  aria-label={`Correct option template ${n}`}
                  checked={spec.correctOptionId === o.id}
                  onChange={() => {
                    setSpec({ correctOptionId: o.id });
                  }}
                />
                <span>Correct</span>
              </label>
              <label className={ui.field}>
                <span className={ui.label}>{`Option template ${n}`}</span>
                <input
                  className={ui.input}
                  type="text"
                  value={o.text}
                  onChange={(e) => {
                    setSpec({
                      options: spec.options.map((row) =>
                        row.id === o.id ? { ...row, text: e.target.value } : row,
                      ),
                    });
                  }}
                />
              </label>
              <button
                type="button"
                className={ui.button}
                aria-label={`Remove option template ${n}`}
                disabled={spec.options.length <= MIN_OPTIONS}
                onClick={() => {
                  onChange(removeSpecOption(form, o.id));
                }}
              >
                Remove
              </button>
            </div>
          );
        })}
        <div>
          <button
            type="button"
            className={ui.button}
            disabled={spec.options.length >= MAX_OPTIONS}
            onClick={() => {
              onChange(addSpecOption(form));
            }}
          >
            Add option template
          </button>
        </div>
        <label className={ui.field}>
          <span className={ui.label}>Number of variants</span>
          <input
            className={ui.input}
            type="text"
            inputMode="numeric"
            value={spec.count}
            onChange={(e) => {
              setSpec({ count: e.target.value });
            }}
          />
        </label>
      </fieldset>

      {problems.length > 0 && (
        <ul role="alert" className={`${ui.items} ${ui.alert}`} aria-label="Parameter spec problems">
          {problems.map((p) => (
            <li key={`${p.path}:${p.message}`}>
              <code>{p.path}</code>
              {` ${p.message}`}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
