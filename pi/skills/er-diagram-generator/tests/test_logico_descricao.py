"""Descrição da entidade dos requisitos: o primeiro parágrafo em prosa abaixo do título (logico._descricao)."""
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "scripts"))
import logico  # noqa: E402


def descricao(texto):
    linhas = texto.splitlines()
    return logico._descricao(linhas, 1, len(linhas))


class DescricaoTest(unittest.TestCase):
    def test_paragrafo_em_varias_linhas_vira_uma(self):
        self.assertEqual(descricao("### E – Usuário\n\nPessoa que acessa\na plataforma.\n\n**Campos**"),
                         "Pessoa que acessa a plataforma.")

    def test_secao_que_abre_com_campos_nao_tem_descricao(self):
        for corpo in ("| Campo | Tipo |", "**Campos**", "`{ id, nome }`", "`codigo`, `nome`", "- item", "```json"):
            with self.subTest(corpo=corpo):
                self.assertIsNone(descricao(f"### E – X\n\n{corpo}\n"))

    def test_markdown_em_linha_fica_para_a_pagina(self):
        self.assertEqual(descricao("### E – Conta\nUnidade de **isolamento** com `account_id`."),
                         "Unidade de **isolamento** com `account_id`.")


if __name__ == "__main__":
    unittest.main()
