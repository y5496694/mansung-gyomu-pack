import math,sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parents[1]/'src'))
from hwp_signature import placement,apply_picture_properties

class Properties:
    def __init__(self):self.values={}
    def SetItem(self,key,value):self.values[key]=value
    def Item(self,key):return self.values[key]
class Picture:
    def __init__(self):self.Properties=Properties()

class SignatureTests(unittest.TestCase):
    def test_behind_text_and_aspect_ratio(self):
        values=placement({'x_mm':140,'y_mm':220,'width_mm':20},(400,200))
        self.assertEqual(values['TreatAsChar'],0)
        self.assertEqual(values['TextWrap'],2)
        self.assertEqual(values['Height'],round(10*7200/25.4))
        self.assertEqual(apply_picture_properties(Picture(),values),values)
    def test_invalid_geometry_rejected(self):
        for invalid in (None,True,'20',float('nan'),float('inf'),-1,500):
            with self.assertRaises(ValueError):placement({'x_mm':10,'y_mm':20,'width_mm':invalid},(100,50))
        with self.assertRaises(ValueError):placement({},(100,50))
    def test_readback_mismatch_rejected(self):
        class Ignored(Properties):
            def SetItem(self,key,value):self.values[key]=0
        picture=Picture();picture.Properties=Ignored()
        with self.assertRaises(ValueError):apply_picture_properties(picture,{'TextWrap':2})

if __name__=='__main__':unittest.main()
