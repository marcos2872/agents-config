"""Leitores de entidades da planta do banco (entidades.py), sobre os exemplos de tests/fixtures/<linguagem>.

Os exemplos ficam com .txt no fim (Pedido.java.txt) para o compilador do projeto em que a skill é copiada não os
tomar por código dele; o teste os copia para uma pasta temporária com o nome real.
"""
import pathlib
import shutil
import sys
import tempfile
import unittest

AQUI = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(AQUI.parent / "scripts"))
import entidades  # noqa: E402

TABELAS = {"faturas", "produtos_estoque", "movimentos", "pedidos", "itemdopedido", "pedido_cupons", "clientes", "configuracoes", "cidades", "estados", "teares",
           "Grupo", "usuarios", "log_de_acesso", "Produtos", "categorias_produto", "entregas", "itens_de_tarefa",
           "fila_de_envio", "entregas_app", "motoristas", "veiculos", "rotas", "fazendas", "talhoes"}


PASTA = tempfile.mkdtemp(prefix="er-entidades-")
for origem in (AQUI / "fixtures").rglob("*.txt"):
    destino = pathlib.Path(PASTA) / origem.relative_to(AQUI / "fixtures").with_suffix("")
    destino.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy(origem, destino)


def tearDownModule():
    shutil.rmtree(PASTA, ignore_errors=True)


def ler(linguagem):
    ents, juncoes, _ = entidades.ler(PASTA, {"linguagem": linguagem, "pastas": [linguagem]}, TABELAS)
    return ents, juncoes


class LeitoresTest(unittest.TestCase):
    def confere(self, linguagem, esperado):
        ents, _ = ler(linguagem)
        self.assertEqual({t: (e["class"], e["doc"]) for t, e in ents.items()}, esperado)

    def test_java_jpa(self):
        self.confere("java", {
            "pedidos": ("Pedido", "Pedido de compra feito por um Cliente. Fecha quando todos os itens são entregues."),
            "itemdopedido": ("ItemDoPedido", "Item de um pedido."),
            "faturas": ("Fatura", "Fatura mensal da conta.")})
        ents, juncoes = ler("java")
        self.assertEqual(ents["pedidos"]["pkg"], "br.exemplo.vendas")
        self.assertEqual(ents["pedidos"]["extends"], "EntidadeBase")
        self.assertEqual(juncoes, {"pedido_cupons": {"kind": "JoinTable", "class": "Pedido"}})

    def test_kotlin_jpa_room_exposed(self):
        self.confere("kotlin", {
            "clientes": ("Cliente", "Cliente da loja."),
            "configuracoes": ("Configuracao", "Configuração local do aplicativo (Room)."),
            "cidades": ("Cidades", "Cidades atendidas (Exposed)."),
            "estados": ("EstadosTable", None),
            "produtos_estoque": ("ProdutoEstoque", "Produto em estoque."),
            "movimentos": ("Movimento", "Movimento de estoque.")})
        ents = ler("kotlin")[0]
        self.assertEqual(ents["clientes"]["extends"], "EntidadeBase")
        self.assertEqual(ents["movimentos"]["extends"], "Auditavel")
        self.assertIsNone(ents["cidades"]["extends"])  # IntIdTable é base do Exposed, não superclasse

    def test_csharp_ef_core(self):
        self.confere("csharp", {"fazendas": ("Fazenda", "Fazenda cadastrada pela conta."),
                                "talhoes": ("Talhao", "Talhão de uma Fazenda.")})
        self.assertEqual(ler("csharp")[0]["fazendas"]["pkg"], "Exemplo.Dados")

    def test_javascript_prisma_typeorm_sequelize_drizzle(self):
        self.confere("javascript", {
            "teares": ("Tear", "Tear da fábrica, com a posição no salão."),
            "Grupo": ("Grupo", None),
            "usuarios": ("Usuario", "Usuário do painel administrativo."),
            "log_de_acesso": ("LogDeAcesso", "Log de acesso, nome pela convenção do TypeORM."),
            "Produtos": ("Produto", "Produto do catálogo."),
            "categorias_produto": ("Categoria", "Categoria do produto."),
            "entregas": ("entregas", "Entregas agendadas.")})
        ents = ler("javascript")[0]
        self.assertEqual(ents["usuarios"]["extends"], "Base")
        self.assertIsNone(ents["categorias_produto"]["extends"])  # Model é a base do Sequelize

    def test_dart_drift_floor(self):
        self.confere("dart", {
            "itens_de_tarefa": ("ItensDeTarefa", "Tarefas do usuário, guardadas no aparelho."),
            "fila_de_envio": ("Fila", "Fila de envio."),
            "entregas_app": ("Entrega", "Entrega do motoboy (Floor).")})

    def test_rust_diesel_seaorm(self):
        self.confere("rust", {
            "motoristas": ("Motorista", "Motorista cadastrado."),
            "veiculos": ("Veiculo", "Veículo da frota, tabela pela convenção do Diesel."),
            "rotas": ("rota::Model", "Rota de entrega (SeaORM).")})
        self.assertEqual(ler("rust")[0]["motoristas"]["pkg"], "models")

    def test_linguagem_padrao_e_apelidos(self):
        self.assertEqual(entidades.linguagens({}), ["java"])
        self.assertEqual(entidades.linguagens({"linguagem": ["ts", "C#"]}), ["javascript", "csharp"])
        with self.assertRaises(ValueError):
            entidades.linguagens({"linguagem": "cobol"})

    def test_sem_tabela_no_banco_fica_com_o_primeiro_candidato(self):
        ents, _, _ = entidades.ler(PASTA, {"linguagem": "java", "pastas": ["java"]}, set())
        self.assertEqual(set(ents), {"pedidos", "itemdopedido", "faturas"})

    def test_nome_sem_aspas_so_vale_no_rust(self):
        self.assertIsNone(entidades.opcao('(name = Colunas.VALOR)', 'name'))
        self.assertEqual(entidades.opcao('table_name = crate::schema::x', 'table_name', ident=True), 'x')


class DocumentacaoTest(unittest.TestCase):
    def test_javadoc_para_na_primeira_marca(self):
        s = "/**\n * Primeira linha.\n * Segunda {@code x}.\n * @param y ignorado\n */\n@Entity\nclass A {}"
        self.assertEqual(entidades.doc_antes(s, s.index("@Entity")), "Primeira linha. Segunda x.")

    def test_doc_de_barras_para_no_titulo(self):
        s = "/// Resumo.\n///\n/// # Exemplo\n/// nada\nstruct A;"
        self.assertEqual(entidades.doc_antes(s, s.index("struct")), "Resumo.")

    def test_comentario_comum_nao_e_documentacao(self):
        s = "/* comum */\n@Entity\nclass A {}"
        self.assertIsNone(entidades.doc_antes(s, s.index("@Entity")))


if __name__ == "__main__":
    unittest.main()
