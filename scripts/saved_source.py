"""Shared read-only saved-source loader for opt-in diagnostics."""
import json
import os
from pathlib import Path

def load_source(root):
    values = {}
    config_file = os.environ.get('BRIDGE_ENV_FILE')
    if not config_file and os.environ.get('NODE_ENV') != 'production' and os.environ.get('BRIDGE_NODE_MODE', 'local') == 'local':
        config_file = '.dev.vars'
    if config_file:
        path = Path(config_file)
        if not path.is_absolute():
            path = root / path
        if path.exists():
            for line in path.read_text().splitlines():
                if line.strip() and not line.lstrip().startswith('#') and '=' in line:
                    key, value = line.split('=', 1)
                    values[key.strip()] = value.strip().strip("\"'")
        elif os.environ.get('BRIDGE_ENV_FILE'):
            raise ValueError('Explicit runtime configuration file is missing')
    values.update(os.environ)
    if not values.get('BRIDGE_THEME_STORE') and (root / 'work/theme-store').exists():
        raise ValueError('Migrate work/theme-store to data while stopped, or explicitly set BRIDGE_THEME_STORE')
    directory = Path(values.get('BRIDGE_THEME_STORE') or 'data')
    if not directory.is_absolute():
        directory = root / directory
    try:
        source = json.loads((directory / 'state.json').read_text())['source']
        return {'baseUrl': source['baseUrl'], 'token': source['token']}
    except (OSError, KeyError, ValueError):
        raise ValueError('Save the data source in the management UI before diagnostics') from None
