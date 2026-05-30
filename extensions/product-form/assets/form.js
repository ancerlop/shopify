(function() {
  const container = document.getElementById('escape-room-fields');
  if (!container) return;

  const productId = container.dataset.productId;
  const proxyPrefix = container.dataset.proxyPrefix || 'apps';
  if (!productId) {
    console.error('[Escape Room] No product ID configured in block settings');
    return;
  }

  const proxyUrl = `/${proxyPrefix}/form-config/${productId}`;

  fetch(proxyUrl)
    .then(r => r.json())
    .then(data => {
      if (!data.fields || data.fields.length === 0) return;
      renderFields(data.fields);
    })
    .catch(() => console.error('[Escape Room] Failed to load form config'));

  function sanitizeId(label) {
    return label.replace(/[^a-zA-Z0-9-]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  }

  function renderFields(fields) {
    const sorted = fields.sort((a, b) => a.sortOrder - b.sortOrder);

    sorted.forEach(field => {
      const wrapper = document.createElement('div');
      wrapper.className = 'escape-room-field';

      const fieldId = `escape-${sanitizeId(field.label)}`;

      const label = document.createElement('label');
      label.textContent = field.label + (field.required ? ' *' : '');
      label.setAttribute('for', fieldId);
      wrapper.appendChild(label);

      if (field.type === 'textarea') {
        const textarea = document.createElement('textarea');
        textarea.id = fieldId;
        textarea.name = `properties[${field.label}]`;
        textarea.required = field.required;
        wrapper.appendChild(textarea);
      } else if (field.type === 'image') {
        const input = document.createElement('input');
        input.type = 'file';
        input.id = fieldId;
        input.accept = 'image/*';
        input.required = field.required;

        const hiddenInput = document.createElement('input');
        hiddenInput.type = 'hidden';
        hiddenInput.name = `properties[${field.label}]`;
        hiddenInput.id = `escape-hidden-${sanitizeId(field.label)}`;

        const preview = document.createElement('img');
        preview.className = 'escape-room-preview';
        preview.style.display = 'none';

        const fileName = document.createElement('div');
        fileName.className = 'file-name';

        input.addEventListener('change', function(e) {
          const file = e.target.files[0];
          if (!file) return;

          fileName.textContent = 'Subiendo...';

          const reader = new FileReader();
          reader.onload = function(ev) {
            preview.src = ev.target.result;
            preview.style.display = 'block';
            hiddenInput.value = ev.target.result;
            fileName.textContent = `✓ ${file.name}`;
          };
          reader.readAsDataURL(file);
        });

        wrapper.appendChild(input);
        wrapper.appendChild(hiddenInput);
        wrapper.appendChild(preview);
        wrapper.appendChild(fileName);
      } else {
        const input = document.createElement('input');
        input.type = 'text';
        input.id = fieldId;
        input.name = `properties[${field.label}]`;
        input.placeholder = `Introduce ${field.label.toLowerCase()}`;
        input.required = field.required;
        wrapper.appendChild(input);
      }

      container.appendChild(wrapper);
    });
  }
})();
