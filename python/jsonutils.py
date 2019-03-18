import json
import inspect

class RecursiveJsonSerializer(json.JSONEncoder):
	def default(self, o):
		if self.isSerializable(o):
			return o
		elif self.isRecursivelySerializable(o):
			dict = { k: self.default(v) for k, v in o.__dict__.items() if self.isRecursivelySerializable(v) or self.isSerializable(v) }
			return dict
		else:
			return ''

	def isSerializable(self, o):
		return isinstance(o, (int, float, str)) or o is None

	def isRecursivelySerializable(self, o):
		return hasattr(o, "__dict__")
