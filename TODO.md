## jobSender

Lets handle first the state of the Control button Cycle/Resume, Pause, Stop

For Cycle button enable condition
- loadedGCodeProgram has value
- machineState.machineState  is Idle
OR
- machineState.machineState is Hold or Door

For Pause Button
- loadedGCodeProgram has value
- machineState.machineState  is Run

For Stop button enable condition

- loadedGCodeProgram has value
- machineState.machineState  is Run, Hold, or Door

When we click the Cycle button and machine is idle, we should call new api to start the job.


Lets create a new routes

# --- Start a G-code Job ---
POST /gcode-job
Content-Type: application/json

{
  "filename": "part1.nc"
}


# --- Pause the Current G-code Job ---
PATCH /gcode-job
Content-Type: application/json

{
  "action": "pause"
}


# --- Resume the Current G-code Job ---
PATCH /gcode-job
Content-Type: application/json

{
  "action": "resume"
}


# --- Stop the Current G-code Job ---
DELETE /gcode-job

The cycle can call either the start api or resume api depending on the state. Resume api if the machineState is Hold. API is async call without waiting and should start a background process that will process the file.

background process will send command line by line to the cnc-controller. The server should already have access to the file since this is already uploaded to files/ folder. The background process should track line number of the gcode and broadcast this on the 'cnc-command-result' type per line/command so all clients can start adding to the console history whats executed. Incase something failed, we stop the process and we add message to the cnc-command-result the line number where it failed. background process should also perform santizer on like ignoring gcode standard comment, complete line or the partial part of the line comment but it should be still track the line number if skip as this is critical when reporting error to the cnc-command-result.


### rename machineState.machineState to machineState.status