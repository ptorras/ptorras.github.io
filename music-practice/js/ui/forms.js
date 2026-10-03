// Builds a settings form from an exercise's option schema.
// Option: { id, label, type: 'select' | 'checkbox', choices?: [[value, label] | { group, choices: [[value, label]] }],
//          default, showIf?: (values) => bool }

export function buildForm(container, options, values, onChange) {
  container.innerHTML = '';
  const rows = [];
  for (const opt of options) {
    if (!(opt.id in values)) values[opt.id] = opt.default;
    const row = document.createElement('label');
    row.className = `field field-${opt.type}`;
    let input;
    if (opt.type === 'checkbox') {
      input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = Boolean(values[opt.id]);
      row.append(input, document.createTextNode(opt.label));
      input.addEventListener('change', () => update(opt.id, input.checked));
    } else {
      const span = document.createElement('span');
      span.textContent = opt.label;
      input = document.createElement('select');
      const flat = [];
      for (const c of opt.choices) {
        if (Array.isArray(c)) {
          input.add(new Option(c[1], c[0]));
          flat.push(c);
        } else {
          const g = document.createElement('optgroup');
          g.label = c.group;
          for (const [v, l] of c.choices) g.appendChild(new Option(l, v));
          input.appendChild(g);
          flat.push(...c.choices);
        }
      }
      if (!flat.some(([v]) => v === values[opt.id])) values[opt.id] = opt.default;
      input.value = values[opt.id];
      row.append(span, input);
      input.addEventListener('change', () => update(opt.id, input.value));
    }
    container.appendChild(row);
    rows.push([opt, row]);
  }
  const refresh = () => {
    for (const [opt, row] of rows) row.hidden = opt.showIf ? !opt.showIf(values) : false;
  };
  function update(id, v) {
    values[id] = v;
    refresh();
    onChange?.(values);
  }
  refresh();
  return values;
}
