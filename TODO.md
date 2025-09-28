## jobSender

Whe click the Cycle button and machine is idle, we should call new api/job/start passing the filename of the loadedgcode.

The server should start reading this file and sending the command line by line to the cnc-controller. The server should already have access to the file since this is already uploaded to files/ folder.

It should ignore the standard gcode comment line for example, line that start with. ";" for sending to the controller.

When reading the file, we should also track a reference line number, so we should count each line including comment for counting as this is useful for tracking if one line failed.
