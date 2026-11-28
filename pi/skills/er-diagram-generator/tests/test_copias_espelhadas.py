"""Os arquivos espelhados entre as skills de diagrama precisam continuar byte a byte iguais.

`fontes.py`, `leitor_csharp.py`, `logico.py` e `vendor.sh` são CÓPIA IDÊNTICA em `er-diagram-generator/scripts/` e
`uml-class-diagram-generator/scripts/`. A duplicação é proposital — o `instalar.sh` do skill-kit copia uma skill por
vez, então cada skill precisa funcionar sozinha —, mas ela tem um custo: corrigir o leitor C# numa e esquecer a outra
não dá erro nenhum, só gera diagrama errado.

Este teste transforma esse esquecimento em falha. Se ele ficar vermelho, copie o arquivo corrigido sobre o gêmeo
(mesmo conteúdo, mesma data não importa) em vez de editar os dois à mão.

Uso: `python3 -m unittest discover -s tests` de dentro da skill, ou `python3 tests/test_copias_espelhadas.py`.
"""
import hashlib
import sys
import unittest
from pathlib import Path

sys.dont_write_bytecode = True

RAIZ = Path(__file__).resolve().parents[1]          # <skill>/er-diagram-generator
SKILLS = RAIZ.parent
PAR = SKILLS / 'uml-class-diagram-generator'

# O que é espelho. Acrescentar aqui quando um arquivo novo passar a servir às duas skills.
ESPELHADOS = ('fontes.py', 'leitor_csharp.py', 'logico.py', 'vendor.sh')


def _hash(caminho):
    return hashlib.sha256(caminho.read_bytes()).hexdigest()


@unittest.skipUnless(PAR.is_dir(), 'skill par não instalada (instalação de uma skill só): nada a conferir')
class CopiasEspelhadas(unittest.TestCase):
    def test_cada_espelho_existe_nos_dois_lados(self):
        for nome in ESPELHADOS:
            with self.subTest(arquivo=nome):
                aqui = RAIZ / 'scripts' / nome
                la = PAR / 'scripts' / nome
                if not aqui.exists() and not la.exists():
                    self.skipTest(f'{nome} não existe em nenhuma das duas: saiu da lista?')
                self.assertTrue(aqui.exists(), f'{nome} sumiu de {RAIZ.name}/scripts')
                self.assertTrue(la.exists(), f'{nome} sumiu de {PAR.name}/scripts')

    def test_espelhos_sao_identicos(self):
        divergentes = []
        for nome in ESPELHADOS:
            aqui = RAIZ / 'scripts' / nome
            la = PAR / 'scripts' / nome
            if not (aqui.exists() and la.exists()):
                continue
            if _hash(aqui) != _hash(la):
                divergentes.append(nome)
        if divergentes:
            self.fail(
                'arquivo espelhado divergiu entre as skills de diagrama: ' + ', '.join(divergentes) +
                '\nCopie o arquivo correto sobre o gêmeo em vez de editar os dois à mão:\n  cp ' +
                ' '.join(f'{RAIZ.name}/scripts/{n}' for n in divergentes) +
                ' ../uml-class-diagram-generator/scripts/  (ou o inverso, conforme onde está a correção)')


if __name__ == '__main__':
    unittest.main()
