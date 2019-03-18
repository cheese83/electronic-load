import math
import json
from jsonutils import RecursiveJsonSerializer

class ElectronicLoadSettings:
	def __init__(self, filename):
		self.filename = filename
		with open(filename, 'r') as file:
			data = json.loads(file.read())
			self.updatePeriod = float(data['updatePeriod'])
			self.calibrations = Calibrations(**data['calibrations'])
			self.presets = { k: Preset(**v) for k, v in data['presets'].items() }
			self.limits = self.presets['default'].limits

	def save(self):
		serialized = json.dumps({ 'updatePeriod': self.updatePeriod, 'calibrations': self.calibrations, 'presets': self.presets }, cls=RecursiveJsonSerializer, indent=4)
		with open(self.filename, 'w') as file:
			file.write(serialized)

class Preset:
	def __init__ (self, limits):
		self.limits = Limits(**limits)

class Calibrations:
	def __init__(self, dac, adc):
		self.dac = ConverterCalibration(**dac)
		self.adc = ConverterCalibration(**adc)

class ConverterCalibration:
	def __init__(self, i, v):
		self.i = Calibration(**i)
		self.v = Calibration(**v)

class Calibration:
	def __init__(self, gain, offset):
		self.gain = float(gain)
		self.offset = float(offset)

	def apply(self, x):
		return (x * self.gain) + self.offset

	def inverseApply(self, x):
		return (x - self.offset) / self.gain

class Limits:
	def __init__(self, i, v, t):
		self.i = Range(**i)
		self.v = Range(**v)
		self.t = Range(**t)

	def exceeded(self, i, v, t):
		return self.i.exceeded(i) or self.v.exceeded(v) or self.t.exceeded(t)

class Range:
	def __init__(self, min, max):
		self.min = float(min)
		self.max = float(max)

	def exceeded(self, x):
		return (self.min > 0 and x < self.min) or (self.max > 0 and x > self.max)
