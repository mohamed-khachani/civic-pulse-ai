import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from common import as_number, section_code, WGS84_TO_UTM
from geo import _ring


def test_codes():
    assert section_code(1,1) == '01001'
    assert section_code('01001') == '01001'
    assert section_code(17,120) == '17120'


def test_numbers():
    assert as_number('1.234,56') == 1234.56
    assert as_number('..') is None


def test_reversed_arcs():
    assert _ring([0, -2], [[[0,0],[1,0]], [[1,1],[1,0]]]) == [[0,0],[1,0],[1,1],[0,0]]
