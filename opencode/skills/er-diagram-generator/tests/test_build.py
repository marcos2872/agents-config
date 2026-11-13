import importlib.util
import unittest
from pathlib import Path


SKILL_DIR = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('er_build', SKILL_DIR / 'scripts' / 'build.py')
BUILD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BUILD)


class ValidarCuradoriaTest(unittest.TestCase):
    def test_accepts_domain_and_description_for_every_table(self):
        data = {
            'domains': [{'id': 'cadastro', 'tables': ['clientes']}],
            'table_descriptions': {'clientes': '  Pessoas que compram os produtos.  '},
        }

        domain_by_table, descriptions = BUILD.validar_curadoria(data, {'clientes'})

        self.assertEqual(domain_by_table, {'clientes': 'cadastro'})
        self.assertEqual(descriptions, {'clientes': 'Pessoas que compram os produtos.'})

    def test_lists_tables_without_description(self):
        data = {'domains': [{'id': 'cadastro', 'tables': ['clientes']}]}

        with self.assertRaisesRegex(ValueError, 'clientes') as error:
            BUILD.validar_curadoria(data, {'clientes'})

        self.assertIn('não têm finalidade', str(error.exception))

    def test_rejects_empty_description(self):
        data = {
            'domains': [{'id': 'cadastro', 'tables': ['clientes']}],
            'table_descriptions': {'clientes': '  '},
        }

        with self.assertRaisesRegex(ValueError, 'descrições vazias ou inválidas'):
            BUILD.validar_curadoria(data, {'clientes'})

    def test_rejects_description_for_unknown_table(self):
        data = {
            'domains': [{'id': 'cadastro', 'tables': ['clientes']}],
            'table_descriptions': {
                'clientes': 'Pessoas que compram os produtos.',
                'cliente_antigo': 'Tabela antiga.',
            },
        }

        with self.assertRaisesRegex(ValueError, 'cliente_antigo'):
            BUILD.validar_curadoria(data, {'clientes'})

    def test_lists_stale_duplicate_and_unassigned_tables(self):
        data = {
            'domains': [
                {'id': 'cadastro', 'tables': ['clientes']},
                {'id': 'outro', 'tables': ['clientes', 'tabela_antiga']},
            ],
            'table_descriptions': {
                'clientes': 'Pessoas que compram os produtos.',
                'pedidos': 'Pedidos feitos por clientes.',
            },
        }

        with self.assertRaises(ValueError) as error:
            BUILD.validar_curadoria(data, {'clientes', 'pedidos'})

        message = str(error.exception)
        self.assertIn('clientes (folhas cadastro e outro)', message)
        self.assertIn('tabela_antiga', message)
        self.assertIn('pedidos', message)


class TableDescriptionsOutputTest(unittest.TestCase):
    def setUp(self):
        schema = [{
            'table': 'clientes',
            'comment': 'Dados de contato.',
            'cols': [{'name': 'cliente_id', 'type': 'integer', 'nn': True, 'def': None}],
            'cons': [{'name': 'clientes_pkey', 'type': 'p', 'cols': ['cliente_id']}],
            'uidx': [],
        }]
        table_descriptions = {'clientes': 'Registra os clientes e seus dados de contato.'}
        tables, fks = BUILD.build_tables(
            schema, {'clientes': 3}, {'clientes': 'cadastro'}, table_descriptions, {}, {}
        )
        self.tables = tables
        self.data = {
            'meta': {
                'db': 'teste', 'schema': 'public', 'stamp': '12/11/2026 10:00',
                'tables': 1, 'fks': fks, 'rows': 3, 'empty': 0, 'flyway': None,
                'html': 'planta.html', 'url': None, 'entidades': False,
            },
            'domains': [{
                'id': 'cadastro', 'label': 'Cadastro', 'hue': 20, 'chroma': 1,
                'desc': 'Dados de clientes.', 'tables': ['clientes'],
            }],
            't': tables,
        }

    def test_description_is_attached_to_table_data(self):
        self.assertEqual(
            self.tables['clientes']['purpose'],
            'Registra os clientes e seus dados de contato.',
        )

    def test_mermaid_includes_description_for_each_table(self):
        markdown = BUILD.render_mermaid(self.data)

        self.assertIn('### Finalidade das tabelas', markdown)
        self.assertIn(
            '- **clientes**: Registra os clientes e seus dados de contato.',
            markdown,
        )

    def test_mermaid_escapes_markup_and_collapses_description_lines(self):
        self.tables['clientes']['purpose'] = 'Armazena <dados>\nassociados.'

        markdown = BUILD.render_mermaid(self.data)

        self.assertIn('- **clientes**: Armazena &lt;dados&gt; associados.', markdown)

    def test_html_panel_shows_escaped_table_description(self):
        self.tables['clientes']['purpose'] = '</script><img src=x>'
        html = BUILD.render_html(self.data, online=True)

        self.assertIn('<p class="purpose"><strong>Finalidade</strong>${esc(t.purpose)}</p>', html)
        self.assertNotIn('</script><img src=x>', html)


if __name__ == '__main__':
    unittest.main()
