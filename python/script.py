import webiopi
from webiopi.devices.instance import DEVICES
from datetime import datetime, timezone
import json
import sys
import os
import subprocess
import numbers
sys.path.append(os.path.dirname(__file__))
from settings import ElectronicLoadSettings, Limits, Calibrations
from jsonutils import RecursiveJsonSerializer

ADC_I_CHANNEL = 0
ADC_V_CHANNEL = 1
DAC_CHANNEL = 0

CCS_GPIO = 17
CVS_GPIO = 18

settings = None
adc = None
dac = None
GPIO = webiopi.GPIO

mode = 'CC'
script = None
scriptMode = None
startTime = None
stopTime = None
lastReadingTime = None
accumulatedReadings = { 'i': [], 'v': [] }
lastReading = None
readings = []

# setup function is automatically called at WebIOPi startup
def setup():
	global adc
	global dac

	adc = webiopi.deviceInstance('ADC')
	dac = webiopi.deviceInstance('DAC')

	GPIO.setFunction(CCS_GPIO, GPIO.OUT)
	GPIO.setFunction(CVS_GPIO, GPIO.OUT)

	global settings

	settingsfile = os.path.join(os.path.dirname(__file__), 'settings.json')
	settings = ElectronicLoadSettings(settingsfile)

	setOutput(0.0, 'CC')

# loop function is repeatedly called by WebIOPi
def loop():
	if not isRunning():
		webiopi.sleep(0.1)
		return

	global lastReadingTime
	global lastReading

	i = readCurrent()
	v = readVoltage()
	now = datetime.now(timezone.utc)
	t = (now - startTime).total_seconds()
	accumulatedReadings['i'].append(i)
	accumulatedReadings['v'].append(v)
	deltaSeconds = (now - lastReadingTime).total_seconds()
	limitsExceeded = settings.limits.exceeded(i, v, t)

	# Read from the ADC as fast as possible, but only return a reading at the predefined rate.
	# All the extra readings can be averaged together to reduce noise, i.e. oversampling.
	if deltaSeconds >= settings.updatePeriod or limitsExceeded:
		lastReadingTime = now
		averageCurrent = sum(accumulatedReadings['i']) / float(len(accumulatedReadings['i']))
		averageVoltage = sum(accumulatedReadings['v']) / float(len(accumulatedReadings['v']))
		lastReading = { 'i': averageCurrent, 'v': averageVoltage, 't': t }
		readings.append(lastReading)
		del accumulatedReadings['i'][:]
		del accumulatedReadings['v'][:]

	if limitsExceeded:
		stop()

	try:
		runScript({ 'i': i, 'v': v, 't': t })
	except Exception:
		stop()

# destroy function is called at WebIOPi shutdown
def destroy():
	GPIO.digitalWrite(CCS_GPIO, GPIO.LOW)
	GPIO.digitalWrite(CVS_GPIO, GPIO.LOW)

def readCurrent():
	return settings.calibrations.adc.i.apply(adc.analogReadVolt(ADC_I_CHANNEL))

def readVoltage():
	return settings.calibrations.adc.v.apply(adc.analogReadVolt(ADC_V_CHANNEL))

def enableOutput():
	if mode == 'CC':
		GPIO.digitalWrite(CVS_GPIO, GPIO.LOW)
		GPIO.digitalWrite(CCS_GPIO, GPIO.HIGH)
	elif mode == 'CV':
		GPIO.digitalWrite(CCS_GPIO, GPIO.LOW)
		GPIO.digitalWrite(CVS_GPIO, GPIO.HIGH)

def disableOutput():
	GPIO.digitalWrite(CCS_GPIO, GPIO.LOW)
	GPIO.digitalWrite(CVS_GPIO, GPIO.LOW)

def getOutput():
	calibration = settings.calibrations.dac.i if mode == 'CC' else settings.calibrations.dac.v
	rawValue = dac.analogRead(DAC_CHANNEL)
	value = max(calibration.inverseApply(rawValue), 0)

	return value

def runScript(datum):
	if not script == None:
		value = eval(script, { '__builtins__': None }, datum)
		if isinstance(value, numbers.Number):
			setOutput(value, scriptMode)

def setOutput(value, newMode):
	global mode

	modeChanged = False
	if mode != newMode:
		# Disable output before changing mode, to avoid it momentarily being set to the wrong value.
		disableOutput()
		mode = newMode
		modeChanged = True

	calibration = settings.calibrations.dac.i if newMode == 'CC' else settings.calibrations.dac.v
	dacValue = max(min(round(calibration.apply(value)), dac.analogMaximum()), 0)
	writtenValue = dac.analogWrite(DAC_CHANNEL, dacValue)

	if modeChanged and isRunning():
		enableOutput()

	return writtenValue

def isRunning():
	return startTime != None and stopTime == None

def readingToDatum(reading, includeStatus):
	if lastReading == None:
		return None

	# Imperfect accuracy may cause values close to 0 to be slightly negative. Clamp them to 0, as they aren't useful.
	datum = { 'i': max(reading['i'], 0), 'v': max(reading['v'], 0), 't': reading['t'] }

	if includeStatus:
		now = datetime.now(timezone.utc)
		age = (now - lastReadingTime).total_seconds()
		datum['age'] = age

		if not isRunning() or lastReading == None:
			datum['stopped'] = True

	return datum

@webiopi.macro('GET', 'iv', 'application/json')
def getData(since=None):
	if len(readings):
		relevantData = []
		if since == None:
			relevantData = readings
		else:
			t = float(since)
			for i, datum in reversed(list(enumerate(readings))):
				if datum['t']  <= t:
					relevantData = readings[i:]
					break
		return json.dumps([readingToDatum(reading, False) for reading in relevantData[:-1]] + [readingToDatum(relevantData[-1], True)])
	else:
		return json.dumps([])

@webiopi.macro('GET', 'load', 'application/json')
def getLoad():
	value = getOutput()
	return json.dumps({ 'mode': mode, 'value': value, 'script': script })

@webiopi.macro('PUT', 'load', 'text/plain')
def setLoad(data):
	global script
	global scriptMode

	dataDict = json.loads(data)

	if 'script' in dataDict:
		script = dataDict['script']
		scriptMode = dataDict['mode']
	else:
		script = None
		scriptMode = None

	return setOutput(float(dataDict['value']), dataDict['mode']) if script == None else None

@webiopi.macro('GET', 'limits', 'application/json')
def getLimits():
	return json.dumps(settings.limits, cls=RecursiveJsonSerializer)

@webiopi.macro('PUT', 'limits', 'text/plain')
def setLimits(data):
	settings.limits = Limits(**json.loads(data))
	return ''

@webiopi.macro('GET', 'calibrations', 'application/json')
def getCalibrations():
	return json.dumps(settings.calibrations, cls=RecursiveJsonSerializer)

@webiopi.macro('PUT', 'calibrations', 'text/plain')
def setCalibrations(data):
	settings.calibrations = Calibrations(**json.loads(data))
	settings.save()
	return ''

@webiopi.macro('GET', 'updateperiod', 'application/json')
def getUpdatePeriod():
	return json.dumps(settings.updatePeriod)

@webiopi.macro('PUT', 'updateperiod', 'text/plain')
def setUpdatePeriod(data):
	settings.updatePeriod = float(data)
	settings.save()
	return ''

@webiopi.macro('POST', 'start', 'text/plain')
def start():
	global startTime
	global stopTime
	global lastReadingTime

	if not isRunning():
		runScript({ 'i': None, 'v': None, 't': 0 })
		startTime = datetime.now(timezone.utc)
		stopTime = None
		lastReadingTime = startTime
		enableOutput()
		del readings[:]

	return startTime

@webiopi.macro('POST', 'stop', 'text/plain')
def stop():
	global stopTime

	if isRunning():
		disableOutput()
		stopTime = datetime.now(timezone.utc)
		del accumulatedReadings['i'][:]
		del accumulatedReadings['v'][:]

	return stopTime

@webiopi.macro('POST', 'shutdown', 'text/plain')
def shutdown():
	return subprocess.check_output(['sudo', 'shutdown', 'now'])

@webiopi.macro('POST', 'brightness', 'text/plain')
def brightness(path):
	actualBrightness = int(subprocess.check_output(['cat', '/sys/class/backlight/rpi_backlight/actual_brightness']))
	increment = 10 if path == 'up' else -10
	value = min(max(int(actualBrightness + increment), 15), 200)

	subprocess.check_output(['sudo', 'bash', '-c', 'echo ' + str(value) + ' > /sys/class/backlight/rpi_backlight/brightness'])

	return value
