import unittest

from easyread.engines import EngineError, parse_json


class ParseJsonTest(unittest.TestCase):
    def test_existing_top_level_block_array_is_preserved(self):
        text = '说明见 [78]。```json\n[{"id":"p1-1","type":"para","en":"Text"}]\n```'
        self.assertEqual(parse_json(text), [{"id": "p1-1", "type": "para", "en": "Text"}])

    def test_unclosed_outer_object_does_not_return_its_block_array(self):
        with self.assertRaises(EngineError):
            parse_json('{"blocks": [{"id":"p1-1"}]')

    def test_code_fences_and_brackets_in_json_strings_are_preserved(self):
        import json
        data = {"blocks": [{"en": '```python\nf({"key": []})\n```', "zh": "[78]"}]}
        self.assertEqual(parse_json("<think>{ignore}</think>\n" + json.dumps(data) + "\nDone."), data)

    def test_empty_object_and_array_are_valid(self):
        self.assertEqual(parse_json("{}"), {})
        self.assertEqual(parse_json("[]"), [])

    def test_citation_brackets_before_object(self):
        # 废话里的 [78] 不能当成 JSON 的开头
        text = '这段是接着第 8 页 [78] 的续文。\n{"blocks": [{"id": "p1-1", "zh": "译文"}]}'
        self.assertEqual(parse_json(text)["blocks"][0]["id"], "p1-1")

    def test_brace_in_prose_before_object(self):
        text = '公式里的 {x} 不是 JSON。\n```json\n{"blocks": []}\n```'
        self.assertEqual(parse_json(text), {"blocks": []})

    def test_broken_outer_object_does_not_return_inner(self):
        # 外层坏了，里面那个小对象不能当成整份结果
        text = '{"blocks": [{"id": "p1-1"}], "checks": {"id": "x"}, "bad": "a" "b"}'
        with self.assertRaises(EngineError):
            parse_json(text)

    def test_tex_backslash_repair(self):
        text = '{"blocks": [{"id": "p1-1", "zh": "行内 $\\alpha$"}]}'
        self.assertEqual(parse_json(text)["blocks"][0]["zh"], "行内 $\\alpha$")

    def test_raw_newline_inside_string(self):
        text = '{"blocks": [{"id": "p1-1", "zh": "第一行\n第二行"}]}'
        self.assertEqual(parse_json(text)["blocks"][0]["zh"], "第一行\n第二行")

    def test_refusal_prose_has_no_json(self):
        text = "**结论：** 这两页不输出译文。下面是页面结构，见 [1] 和 [2]。"
        with self.assertRaisesRegex(EngineError, "沒有 JSON"):
            parse_json(text)


if __name__ == "__main__":
    unittest.main()
